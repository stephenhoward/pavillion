import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import CalendarInterface from '@/server/calendar/interface';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { EventObject } from '@/server/activitypub/model/object/event';

/**
 * Integration tests for externalUrl + urlPrompt AP federation round-trip.
 *
 * The end-to-end path under test:
 *
 *   local CalendarEvent  -- EventObject.toActivityPubObject -->  AS JSON
 *            AS JSON     -- EventObject.fromActivityPubObject -> eventParams
 *            eventParams -- calendarInterface.addRemoteEvent ---> stored EventEntity
 *            stored EventEntity -- getEventById --> CalendarEvent
 *
 * This exercises the real service + entity + SQLite stack for the AP sides
 * of externalUrl/urlPrompt handling, complementing the unit tests in
 * `src/server/activitypub/test/model/object/event.test.ts`.
 */
describe('Event externalUrl + urlPrompt — AP federation round-trip (integration)', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let testAccount: Account;
  let sourceCalendar: Calendar;
  let eventBus: EventEmitter;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);

    calendarInterface.setActivityPubInterface({
      getSharedEventIds: async () => [],
      getSharedEventStatusMap: async () => new Map(),
      findCalendarActorByCalendarId: async () => null,
    } as any);

    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const info = await accountService._setupAccount('ap-exturl@pavillion.dev', 'testpassword');
    testAccount = info.account;
    sourceCalendar = await calendarInterface.createCalendar(testAccount, 'apexturlsource');
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    await env.cleanup();
  });

  /**
   * Build a Calendar-shaped model for a pretend "remote" calendar. The AP
   * EventObject only uses the urlName to construct the `attributedTo` URL,
   * so this does not need to be persisted.
   */
  function makeRemoteCalendarModel(urlName: string): Calendar {
    return new Calendar(uuidv4(), urlName);
  }

  describe('serialize → parse preservation', () => {
    it('preserves externalUrl and urlPrompt when both fields are set', async () => {
      // Outbound: create a local source event with both fields set
      const sourceEvent = await calendarInterface.createEvent(testAccount, {
        calendarId: sourceCalendar.id,
        content: {
          en: { name: 'Round-trip Tickets Event' },
        },
        start_date: '2026-06-01',
        externalUrl: 'https://example.com/tix',
        urlPrompt: 'tickets',
      });

      // Serialize via EventObject (the same path the outbox dispatcher uses)
      const apObject = new EventObject(sourceCalendar, sourceEvent).toActivityPubObject();

      expect(apObject.attachment).toEqual([
        {
          type: 'Link',
          href: 'https://example.com/tix',
          name: 'Tickets',
          rel: 'external',
        },
      ]);
      expect(apObject['pavillion:urlPrompt']).toBe('tickets');

      // Inbound: parse the AS JSON and store on a fresh "receiver" calendar
      const parsedParams = EventObject.fromActivityPubObject(apObject);
      expect(parsedParams.externalUrl).toBe('https://example.com/tix');
      expect(parsedParams.urlPrompt).toBe('tickets');

      const receiverCalendar = await calendarInterface.createCalendar(testAccount, 'apreceiver1');
      const storedEventId = uuidv4();
      await calendarInterface.addRemoteEvent(receiverCalendar, {
        ...parsedParams,
        id: storedEventId,
        calendarId: receiverCalendar.id,
      });

      const stored = await calendarInterface.getEventById(storedEventId);
      expect(stored.externalUrl).toBe('https://example.com/tix');
      expect(stored.urlPrompt).toBe('tickets');
    });

    it('preserves null externalUrl and null urlPrompt when neither field is set', async () => {
      const sourceEvent = await calendarInterface.createEvent(testAccount, {
        calendarId: sourceCalendar.id,
        content: {
          en: { name: 'Round-trip No URL Event' },
        },
        start_date: '2026-06-02',
      });

      const apObject = new EventObject(sourceCalendar, sourceEvent).toActivityPubObject();
      expect(apObject).not.toHaveProperty('attachment');
      expect(apObject).not.toHaveProperty('pavillion:urlPrompt');

      const parsedParams = EventObject.fromActivityPubObject(apObject);
      expect(parsedParams.externalUrl).toBeNull();
      expect(parsedParams.urlPrompt).toBeNull();

      const receiverCalendar = await calendarInterface.createCalendar(testAccount, 'apreceiver2');
      const storedEventId = uuidv4();
      await calendarInterface.addRemoteEvent(receiverCalendar, {
        ...parsedParams,
        id: storedEventId,
        calendarId: receiverCalendar.id,
      });

      const stored = await calendarInterface.getEventById(storedEventId);
      expect(stored.externalUrl).toBeNull();
      expect(stored.urlPrompt).toBeNull();
    });

    it('emits exactly attachment[Link rel:external] plus pavillion:urlPrompt (no url-field overload)', async () => {
      const sourceEvent = await calendarInterface.createEvent(testAccount, {
        calendarId: sourceCalendar.id,
        content: { en: { name: 'Shape Check Event' } },
        start_date: '2026-06-03',
        externalUrl: 'https://example.com/rsvp',
        urlPrompt: 'rsvp',
      });

      const apObject = new EventObject(sourceCalendar, sourceEvent).toActivityPubObject();

      // attachment contains exactly one well-formed Link entry
      expect(Array.isArray(apObject.attachment)).toBe(true);
      expect(apObject.attachment).toHaveLength(1);
      const att = apObject.attachment[0];
      expect(att.type).toBe('Link');
      expect(att.href).toBe('https://example.com/rsvp');
      expect(att.name).toBe('RSVP');
      expect(att.rel).toBe('external');
      expect(Object.keys(att).sort()).toEqual(['href', 'name', 'rel', 'type']);

      // pavillion:urlPrompt extension carries the raw enum token
      expect(apObject['pavillion:urlPrompt']).toBe('rsvp');

      // AS top-level `url` field must NOT be overloaded with the external URL
      // (reserved for the canonical event page; Mobilizon compatibility).
      if (apObject.url !== undefined) {
        expect(apObject.url).not.toBe('https://example.com/rsvp');
      }
    });
  });

  describe('malicious inbound payloads are dropped on storage', () => {
    it('stores null externalUrl and null urlPrompt when inbound href is javascript:', async () => {
      // Hand-crafted hostile AS payload (as if from a malicious peer)
      const hostileApObject: Record<string, any> = {
        type: 'Event',
        id: `https://evil.example.com/calendars/baddie/events/${uuidv4()}`,
        attributedTo: 'https://evil.example.com/calendars/baddie',
        name: 'Malicious Event',
        startTime: '2026-06-10T10:00:00Z',
        endTime: '2026-06-10T11:00:00Z',
        attachment: [
          {
            type: 'Link',
            href: 'javascript:alert(1)',
            name: 'Tickets',
            rel: 'external',
          },
        ],
        'pavillion:urlPrompt': 'tickets',
      };

      const parsedParams = EventObject.fromActivityPubObject(hostileApObject);
      // Cross-field rule: both must be null when either is invalid
      expect(parsedParams.externalUrl).toBeNull();
      expect(parsedParams.urlPrompt).toBeNull();

      const receiverCalendar = await calendarInterface.createCalendar(testAccount, 'apreceiverhostilejs');
      const storedEventId = uuidv4();
      await calendarInterface.addRemoteEvent(receiverCalendar, {
        ...parsedParams,
        id: storedEventId,
        calendarId: receiverCalendar.id,
        content: { en: { name: 'Malicious Event' } },
      });

      const stored: CalendarEvent = await calendarInterface.getEventById(storedEventId);
      expect(stored.externalUrl).toBeNull();
      expect(stored.urlPrompt).toBeNull();
    });

    it('stores null externalUrl and null urlPrompt when inbound pavillion:urlPrompt is not whitelisted', async () => {
      const hostileApObject: Record<string, any> = {
        type: 'Event',
        id: `https://remote.example.com/calendars/ok/events/${uuidv4()}`,
        attributedTo: 'https://remote.example.com/calendars/ok',
        name: 'Unknown Prompt Event',
        startTime: '2026-06-11T10:00:00Z',
        endTime: '2026-06-11T11:00:00Z',
        attachment: [
          {
            type: 'Link',
            href: 'https://example.com/legit',
            name: 'Buy Tickets',
            rel: 'external',
          },
        ],
        // Not in the whitelist — should cause both fields to be nulled
        'pavillion:urlPrompt': 'nope',
      };

      const parsedParams = EventObject.fromActivityPubObject(hostileApObject);
      expect(parsedParams.externalUrl).toBeNull();
      expect(parsedParams.urlPrompt).toBeNull();

      const receiverCalendar = await calendarInterface.createCalendar(testAccount, 'apreceiverunknownprompt');
      const storedEventId = uuidv4();
      await calendarInterface.addRemoteEvent(receiverCalendar, {
        ...parsedParams,
        id: storedEventId,
        calendarId: receiverCalendar.id,
        content: { en: { name: 'Unknown Prompt Event' } },
      });

      const stored = await calendarInterface.getEventById(storedEventId);
      expect(stored.externalUrl).toBeNull();
      expect(stored.urlPrompt).toBeNull();
    });

    it('stores null externalUrl and null urlPrompt when inbound href is a data: URI', async () => {
      const hostileApObject: Record<string, any> = {
        type: 'Event',
        id: `https://remote.example.com/calendars/ok/events/${uuidv4()}`,
        attributedTo: 'https://remote.example.com/calendars/ok',
        name: 'Data URI Event',
        startTime: '2026-06-12T10:00:00Z',
        endTime: '2026-06-12T11:00:00Z',
        attachment: [
          {
            type: 'Link',
            href: 'data:text/html,<script>alert(1)</script>',
            name: 'Tickets',
            rel: 'external',
          },
        ],
        'pavillion:urlPrompt': 'tickets',
      };

      const parsedParams = EventObject.fromActivityPubObject(hostileApObject);
      expect(parsedParams.externalUrl).toBeNull();
      expect(parsedParams.urlPrompt).toBeNull();

      const receiverCalendar = await calendarInterface.createCalendar(testAccount, 'apreceiverdata');
      const storedEventId = uuidv4();
      await calendarInterface.addRemoteEvent(receiverCalendar, {
        ...parsedParams,
        id: storedEventId,
        calendarId: receiverCalendar.id,
        content: { en: { name: 'Data URI Event' } },
      });

      const stored = await calendarInterface.getEventById(storedEventId);
      expect(stored.externalUrl).toBeNull();
      expect(stored.urlPrompt).toBeNull();
    });
  });

  describe('cross-instance round-trip (outbound → inbound → outbound)', () => {
    it('serializes again from a stored remote event with identical attachment + pavillion:urlPrompt', async () => {
      // Outbound from source
      const sourceEvent = await calendarInterface.createEvent(testAccount, {
        calendarId: sourceCalendar.id,
        content: { en: { name: 'Double Hop Event' } },
        start_date: '2026-06-20',
        externalUrl: 'https://example.com/info',
        urlPrompt: 'more_info',
      });

      const firstAp = new EventObject(sourceCalendar, sourceEvent).toActivityPubObject();

      // Receive and store as a remote event on a second calendar
      const receiverCalendar = await calendarInterface.createCalendar(testAccount, 'apdoublehop');
      const storedEventId = uuidv4();
      await calendarInterface.addRemoteEvent(receiverCalendar, {
        ...EventObject.fromActivityPubObject(firstAp),
        id: storedEventId,
        calendarId: receiverCalendar.id,
      });
      const storedRemote = await calendarInterface.getEventById(storedEventId);

      // Now serialize that remote event again (simulating a re-broadcast)
      const secondAp = new EventObject(receiverCalendar, storedRemote).toActivityPubObject();

      expect(secondAp.attachment).toEqual([
        {
          type: 'Link',
          href: 'https://example.com/info',
          name: 'More Information',
          rel: 'external',
        },
      ]);
      expect(secondAp['pavillion:urlPrompt']).toBe('more_info');
    });
  });

  // Silence unused-variable lint on the helper — it is imported here for
  // future tests that may want to construct payloads attributed to a
  // remote-looking calendar identity without persisting it.
  it('helper makeRemoteCalendarModel is usable for AP payload construction', () => {
    const remote = makeRemoteCalendarModel('notlocal');
    expect(remote.urlName).toBe('notlocal');
    expect(remote.id).toMatch(/^[0-9a-f-]+$/i);
  });
});
