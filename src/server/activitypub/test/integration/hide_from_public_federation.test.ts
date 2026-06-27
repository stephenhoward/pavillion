import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { EventObject } from '@/server/activitypub/model/object/event';

/**
 * Integration tests for the origin-actor gate on the `hideFromPublic` field
 * of `pavillion:schedules` entries.
 *
 * Invariant under test: only the event's source instance may set the
 * cancellation-state flag. Payloads from actors whose domain does not match
 * the event origin are ignored for this field, while the rest of the event
 * update continues through normally.
 *
 * End-to-end path:
 *
 *   crafted AP payload
 *     -- EventObject.fromActivityPubObject(apObject, { actorUri }) -->
 *     eventParams
 *     -- calendarInterface.addRemoteEvent --> persisted EventEntity +
 *        EventScheduleEntity (with hide_from_public set or not)
 *     -- getEventById --> CalendarEvent with schedules
 */
describe('hideFromPublic federation — origin-actor gate (integration)', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let testAccount: Account;
  let receiverCalendar: Calendar;
  let eventBus: EventEmitter;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);

    calendarInterface.setActivityPubInterface({
      getSharedEventStatusMap: async () => new Map(),
      findCalendarActorByCalendarId: async () => null,
    } as any);

    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const info = await accountService._setupAccount('ap-hidefrompublic@pavillion.dev', 'testpassword');
    testAccount = info.account;
    receiverCalendar = await calendarInterface.createCalendar(testAccount, 'aphidefrompub');
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    await env.cleanup();
  });

  /**
   * Hand-craft an AP Event payload whose origin is
   * https://origin.example/calendars/owner and that includes a cancellation
   * override schedule (isException=true, hideFromPublic=false).
   */
  function makePayload(eventSlug: string) {
    const origin = 'https://origin.example';
    return {
      type: 'Event',
      id: `${origin}/calendars/owner/events/${eventSlug}`,
      attributedTo: `${origin}/calendars/owner`,
      name: 'Origin Event',
      startTime: '2026-04-15T09:00:00Z',
      endTime: '2026-04-15T10:00:00Z',
      'pavillion:content': {
        en: { name: 'Origin Event', description: '' },
      },
      'pavillion:schedules': [
        {
          id: uuidv4(),
          start: '2026-04-15T09:00:00Z',
          end: '2026-04-15T10:00:00Z',
          isException: true,
          hideFromPublic: false,
        },
      ],
    };
  }

  it('persists hideFromPublic when the activity actor shares the event origin domain', async () => {
    const payload = makePayload('origin-evt-1');

    const parsed = EventObject.fromActivityPubObject(payload, {
      actorUri: 'https://origin.example/calendars/owner',
    });
    expect(parsed.schedules).toHaveLength(1);
    expect(parsed.schedules[0].hideFromPublic).toBe(false);

    const storedEventId = uuidv4();
    await calendarInterface.addRemoteEvent(receiverCalendar, {
      ...parsed,
      id: storedEventId,
      calendarId: receiverCalendar.id,
    });

    const stored = await calendarInterface.getEventById(storedEventId);
    expect(stored.schedules).toHaveLength(1);
    expect(stored.schedules[0].isExclusion).toBe(true);
    expect(stored.schedules[0].hideFromPublic).toBe(false);
  });

  it('ignores hideFromPublic when the activity actor is from a different domain', async () => {
    const payload = makePayload('origin-evt-2');

    const parsed = EventObject.fromActivityPubObject(payload, {
      actorUri: 'https://other.example/users/editor',
    });

    // Parser strips hideFromPublic from schedule entries before persistence
    expect(parsed.schedules).toHaveLength(1);
    expect(parsed.schedules[0]).not.toHaveProperty('hideFromPublic');

    const storedEventId = uuidv4();
    await calendarInterface.addRemoteEvent(receiverCalendar, {
      ...parsed,
      id: storedEventId,
      calendarId: receiverCalendar.id,
    });

    const stored = await calendarInterface.getEventById(storedEventId);
    expect(stored.schedules).toHaveLength(1);
    // The rest of the schedule persisted normally; hideFromPublic falls back
    // to the model default (true) because the non-origin actor could not set it.
    expect(stored.schedules[0].hideFromPublic).toBe(true);
  });

  it('continues to apply non-privileged event updates from non-origin actors', async () => {
    // Even when the non-origin actor cannot set hideFromPublic, the rest of
    // the payload (name, description, schedule timing) still lands on the
    // stored event.
    const payload = {
      type: 'Event',
      id: 'https://origin.example/calendars/owner/events/origin-evt-3',
      attributedTo: 'https://origin.example/calendars/owner',
      name: 'Title From Editor',
      'pavillion:content': {
        en: { name: 'Title From Editor', description: 'Description from editor' },
      },
      'pavillion:schedules': [
        {
          id: uuidv4(),
          start: '2026-05-01T12:00:00Z',
          end: '2026-05-01T13:00:00Z',
          isException: false,
          hideFromPublic: false,
        },
      ],
    };

    const parsed = EventObject.fromActivityPubObject(payload, {
      actorUri: 'https://other.example/users/editor',
    });

    const storedEventId = uuidv4();
    await calendarInterface.addRemoteEvent(receiverCalendar, {
      ...parsed,
      id: storedEventId,
      calendarId: receiverCalendar.id,
    });

    const stored = await calendarInterface.getEventById(storedEventId);
    expect(stored._content.en.name).toBe('Title From Editor');
    expect(stored._content.en.description).toBe('Description from editor');
    expect(stored.schedules).toHaveLength(1);
    expect(stored.schedules[0].isExclusion).toBe(false);
    // Privileged field defaulted (not forged); other schedule fields preserved.
    expect(stored.schedules[0].hideFromPublic).toBe(true);
  });
});
