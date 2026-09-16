import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { ValidationError } from '@/common/exceptions/base';
import CalendarInterface from '@/server/calendar/interface';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { IMAGE_ALT_MAX_LENGTH } from '@/server/calendar/service/image_alt';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * Integration tests for event content imageAlt.
 *
 * Exercises the full calendar interface -> service -> entity -> SQLite stack
 * without mocks, across both trust levels that write a content row:
 *
 *   - The author-facing create/update paths, which validate and reject.
 *   - The inbound federation paths (addRemoteEvent / updateRemoteEvent), which
 *     normalize and drop, because a peer cannot be shown a validation error
 *     and must not be able to make an event un-ingestable by attaching a bad
 *     alt text to it.
 */
describe('Event content imageAlt — write paths (integration)', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let testAccount: Account;
  let testCalendar: Calendar;
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

    const info = await accountService._setupAccount('imagealt@pavillion.dev', 'testpassword');
    testAccount = info.account;
    testCalendar = await calendarInterface.createCalendar(testAccount, 'imagealtcalendar');
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    await env.cleanup();
  });

  describe('author-facing writes', () => {
    it('persists imageAlt on create and returns it on fetch', async () => {
      const created = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: {
          en: {
            name: 'Illustrated Event',
            description: 'An event with an image',
            imageAlt: 'A crowd dancing under string lights',
          },
        },
        start_date: '2026-07-01',
      });

      expect(created.content('en').imageAlt).toBe('A crowd dancing under string lights');

      const fetched = await calendarInterface.getEventById(created.id);
      expect(fetched.content('en').imageAlt).toBe('A crowd dancing under string lights');
    });

    it('keeps each language independent', async () => {
      const created = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: {
          en: { name: 'Bilingual Event', imageAlt: 'A crowd dancing' },
          fr: { name: 'Événement bilingue', imageAlt: 'Une foule qui danse' },
        },
        start_date: '2026-07-02',
      });

      const fetched = await calendarInterface.getEventById(created.id);
      expect(fetched.content('en').imageAlt).toBe('A crowd dancing');
      expect(fetched.content('fr').imageAlt).toBe('Une foule qui danse');
    });

    it('leaves imageAlt empty when the author supplies none', async () => {
      const created = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: { en: { name: 'Decorative Image Event', description: 'No alt text' } },
        start_date: '2026-07-03',
      });

      const fetched = await calendarInterface.getEventById(created.id);
      expect(fetched.content('en').imageAlt).toBe('');
    });

    it('trims padding and strips markup and bidi controls on create', async () => {
      const created = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: {
          en: { name: 'Hostile Alt Event', imageAlt: '  <b>A crowd</b> dancing‮  ' },
        },
        start_date: '2026-07-04',
      });

      const fetched = await calendarInterface.getEventById(created.id);
      expect(fetched.content('en').imageAlt).toBe('A crowd dancing');
    });

    it('rejects an over-long imageAlt on create', async () => {
      await expect(calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: {
          en: { name: 'Too Much Alt', imageAlt: 'a'.repeat(IMAGE_ALT_MAX_LENGTH + 1) },
        },
        start_date: '2026-07-05',
      })).rejects.toThrow(ValidationError);
    });

    it('updates imageAlt on an existing content row', async () => {
      const created = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: { en: { name: 'Update Alt Event', imageAlt: 'Original alt text' } },
        start_date: '2026-07-06',
      });

      await calendarInterface.updateEvent(testAccount, created.id, {
        content: { en: { name: 'Update Alt Event', imageAlt: 'Corrected alt text' } },
      });

      const fetched = await calendarInterface.getEventById(created.id);
      expect(fetched.content('en').imageAlt).toBe('Corrected alt text');
    });

    it('clears imageAlt when an update omits it, matching the other content fields', async () => {
      const created = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: { en: { name: 'Clear Alt Event', imageAlt: 'Alt to be removed' } },
        start_date: '2026-07-07',
      });

      await calendarInterface.updateEvent(testAccount, created.id, {
        content: { en: { name: 'Clear Alt Event' } },
      });

      const fetched = await calendarInterface.getEventById(created.id);
      expect(fetched.content('en').imageAlt).toBe('');
    });

    it('rejects an over-long imageAlt on update', async () => {
      const created = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: { en: { name: 'Update Too Much Alt', imageAlt: 'Original alt text' } },
        start_date: '2026-07-08',
      });

      await expect(calendarInterface.updateEvent(testAccount, created.id, {
        content: { en: { name: 'Update Too Much Alt', imageAlt: 'a'.repeat(IMAGE_ALT_MAX_LENGTH + 1) } },
      })).rejects.toThrow(ValidationError);

      const fetched = await calendarInterface.getEventById(created.id);
      expect(fetched.content('en').imageAlt).toBe('Original alt text');
    });

    it('keeps a content row whose only field is imageAlt', async () => {
      // A decorative-by-default image that the author described in one
      // language only still produces a real content row: the update loop must
      // not treat "alt text and nothing else" as an empty entry to delete.
      const created = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: { en: { name: 'Alt Only Event' } },
        start_date: '2026-07-09',
      });

      await calendarInterface.updateEvent(testAccount, created.id, {
        content: { fr: { imageAlt: 'Une foule qui danse' } },
      });

      const fetched = await calendarInterface.getEventById(created.id);
      expect(fetched.content('fr').imageAlt).toBe('Une foule qui danse');
      expect(fetched.content('en').imageAlt).toBe('');
    });
  });

  describe('inbound federation writes', () => {
    const remoteEventId = (n: number) => `https://peer.example/calendars/theirs/events/${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;

    it('persists a peer-supplied imageAlt', async () => {
      const event = await calendarInterface.addRemoteEvent(testCalendar, {
        id: remoteEventId(1),
        content: { en: { name: 'Remote Event', imageAlt: 'A crowd dancing' } },
      });

      const fetched = await calendarInterface.getEventById(event.id);
      expect(fetched.content('en').imageAlt).toBe('A crowd dancing');
    });

    it('drops an over-long peer imageAlt without rejecting the event', async () => {
      // The availability property: a sloppy or hostile peer must not be able to
      // make an event un-ingestable by over-filling one optional field.
      const event = await calendarInterface.addRemoteEvent(testCalendar, {
        id: remoteEventId(2),
        content: {
          en: { name: 'Remote Event With Too Much Alt', imageAlt: 'a'.repeat(IMAGE_ALT_MAX_LENGTH + 1) },
        },
      });

      const fetched = await calendarInterface.getEventById(event.id);
      expect(fetched.content('en').name).toBe('Remote Event With Too Much Alt');
      expect(fetched.content('en').imageAlt).toBe('');
    });

    it('drops a non-string peer imageAlt without rejecting the event', async () => {
      const event = await calendarInterface.addRemoteEvent(testCalendar, {
        id: remoteEventId(3),
        content: { en: { name: 'Remote Event With Odd Alt', imageAlt: { en: 'nope' } } },
      });

      const fetched = await calendarInterface.getEventById(event.id);
      expect(fetched.content('en').name).toBe('Remote Event With Odd Alt');
      expect(fetched.content('en').imageAlt).toBe('');
    });

    it('normalizes a peer imageAlt before storing it', async () => {
      const event = await calendarInterface.addRemoteEvent(testCalendar, {
        id: remoteEventId(4),
        content: { en: { name: 'Remote Event', imageAlt: '  A crowd‮ dancing  ' } },
      });

      const fetched = await calendarInterface.getEventById(event.id);
      expect(fetched.content('en').imageAlt).toBe('A crowd dancing');
    });

    it("lands a peer's correction to the alt text on an existing content row", async () => {
      const event = await calendarInterface.addRemoteEvent(testCalendar, {
        id: remoteEventId(5),
        content: { en: { name: 'Remote Event', imageAlt: 'Original remote alt' } },
      });

      await calendarInterface.updateRemoteEvent(testCalendar, {
        id: event.id,
        content: { en: { name: 'Remote Event', imageAlt: 'Corrected remote alt' } },
      });

      const fetched = await calendarInterface.getEventById(event.id);
      expect(fetched.content('en').imageAlt).toBe('Corrected remote alt');
    });

    it('drops an over-long imageAlt on a peer update without rejecting the update', async () => {
      const event = await calendarInterface.addRemoteEvent(testCalendar, {
        id: remoteEventId(6),
        content: { en: { name: 'Remote Event', imageAlt: 'Original remote alt' } },
      });

      await calendarInterface.updateRemoteEvent(testCalendar, {
        id: event.id,
        content: { en: { name: 'Remote Event Renamed', imageAlt: 'a'.repeat(IMAGE_ALT_MAX_LENGTH + 1) } },
      });

      const fetched = await calendarInterface.getEventById(event.id);
      expect(fetched.content('en').name).toBe('Remote Event Renamed');
      expect(fetched.content('en').imageAlt).toBe('');
    });
  });
});
