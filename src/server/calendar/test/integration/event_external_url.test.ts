import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { ValidationError } from '@/common/exceptions/base';
import { InvalidExternalUrlError } from '@/common/exceptions/calendar';

/**
 * Integration tests for externalUrl + urlPrompt API round-trip.
 *
 * Exercises the full calendar interface → service → entity → SQLite stack
 * without mocks. Covers the happy path (create → get), the clearing path
 * (update to null → get), and cross-field / validation guards that must
 * surface as ValidationError or InvalidExternalUrlError rather than silently
 * persisting partial or malicious data.
 */
describe('Event externalUrl + urlPrompt — API round-trip (integration)', () => {
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

    // Minimal AP interface stub: integration tests here do not wire the AP
    // domain, so we return shapes that keep local-only code paths correct.
    calendarInterface.setActivityPubInterface({
      getSharedEventStatusMap: async () => new Map(),
      findCalendarActorByCalendarId: async () => null,
    } as any);

    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const info = await accountService._setupAccount('exturl@pavillion.dev', 'testpassword');
    testAccount = info.account;
    testCalendar = await calendarInterface.createCalendar(testAccount, 'exturlcalendar');
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    await env.cleanup();
  });

  describe('create + read round-trip', () => {
    it('persists externalUrl and urlPrompt when both fields are set on create', async () => {
      const created = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: {
          en: { name: 'Tickets Event', description: 'Buy tickets here' },
        },
        start_date: '2026-05-01',
        externalUrl: 'https://example.com/tix',
        urlPrompt: 'tickets',
      });

      expect(created.externalUrl).toBe('https://example.com/tix');
      expect(created.urlPrompt).toBe('tickets');

      const fetched = await calendarInterface.getEventById(created.id);
      expect(fetched.externalUrl).toBe('https://example.com/tix');
      expect(fetched.urlPrompt).toBe('tickets');
    });

    it('persists null externalUrl and null urlPrompt when neither is set', async () => {
      const created = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: {
          en: { name: 'No URL Event' },
        },
        start_date: '2026-05-02',
      });

      expect(created.externalUrl).toBeNull();
      expect(created.urlPrompt).toBeNull();

      const fetched = await calendarInterface.getEventById(created.id);
      expect(fetched.externalUrl).toBeNull();
      expect(fetched.urlPrompt).toBeNull();
    });

    it('clears both fields via update and persists the cleared state', async () => {
      const created = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: {
          en: { name: 'To Be Cleared' },
        },
        start_date: '2026-05-03',
        externalUrl: 'https://example.com/rsvp',
        urlPrompt: 'rsvp',
      });

      expect(created.externalUrl).toBe('https://example.com/rsvp');
      expect(created.urlPrompt).toBe('rsvp');

      const updated = await calendarInterface.updateEvent(testAccount, created.id, {
        externalUrl: null,
        urlPrompt: null,
      });
      expect(updated.externalUrl).toBeNull();
      expect(updated.urlPrompt).toBeNull();

      const fetched = await calendarInterface.getEventById(created.id);
      expect(fetched.externalUrl).toBeNull();
      expect(fetched.urlPrompt).toBeNull();
    });

    it('accepts all three urlPrompt values end-to-end', async () => {
      for (const prompt of ['tickets', 'rsvp', 'more_info'] as const) {
        const created = await calendarInterface.createEvent(testAccount, {
          calendarId: testCalendar.id,
          content: {
            en: { name: `Prompt ${prompt} Event` },
          },
          start_date: '2026-05-04',
          externalUrl: `https://example.com/${prompt}`,
          urlPrompt: prompt,
        });
        const fetched = await calendarInterface.getEventById(created.id);
        expect(fetched.urlPrompt).toBe(prompt);
        expect(fetched.externalUrl).toBe(`https://example.com/${prompt}`);
      }
    });
  });

  describe('partial-state validation (cross-field rule)', () => {
    it('rejects create with externalUrl set and urlPrompt null, citing both fields', async () => {
      const err = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: { en: { name: 'Partial A' } },
        start_date: '2026-05-05',
        externalUrl: 'https://example.com/oops',
        urlPrompt: null,
      }).catch(e => e);

      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields).toBeDefined();
      expect((err as ValidationError).fields).toHaveProperty('externalUrl');
      expect((err as ValidationError).fields).toHaveProperty('urlPrompt');
    });

    it('rejects create with urlPrompt set and externalUrl null, citing both fields', async () => {
      const err = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: { en: { name: 'Partial B' } },
        start_date: '2026-05-06',
        externalUrl: null,
        urlPrompt: 'rsvp',
      }).catch(e => e);

      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields).toBeDefined();
      expect((err as ValidationError).fields).toHaveProperty('externalUrl');
      expect((err as ValidationError).fields).toHaveProperty('urlPrompt');
    });

    it('rejects update that moves an event into partial state (url set, prompt cleared)', async () => {
      const created = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: { en: { name: 'Partial Update A' } },
        start_date: '2026-05-07',
        externalUrl: 'https://example.com/old',
        urlPrompt: 'tickets',
      });

      const err = await calendarInterface.updateEvent(testAccount, created.id, {
        externalUrl: 'https://example.com/new',
        urlPrompt: null,
      }).catch(e => e);

      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields).toHaveProperty('externalUrl');
      expect((err as ValidationError).fields).toHaveProperty('urlPrompt');

      // Stored record must be untouched by the failed update
      const fetched = await calendarInterface.getEventById(created.id);
      expect(fetched.externalUrl).toBe('https://example.com/old');
      expect(fetched.urlPrompt).toBe('tickets');
    });

    it('rejects update that moves an event into partial state (prompt set, url cleared)', async () => {
      const created = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: { en: { name: 'Partial Update B' } },
        start_date: '2026-05-08',
        externalUrl: 'https://example.com/old',
        urlPrompt: 'tickets',
      });

      const err = await calendarInterface.updateEvent(testAccount, created.id, {
        externalUrl: null,
        urlPrompt: 'rsvp',
      }).catch(e => e);

      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields).toHaveProperty('externalUrl');
      expect((err as ValidationError).fields).toHaveProperty('urlPrompt');
    });
  });

  describe('malicious / invalid payload rejection', () => {
    it('rejects create with a javascript: externalUrl via InvalidExternalUrlError', async () => {
      await expect(calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: { en: { name: 'JS URL' } },
        start_date: '2026-05-09',
        externalUrl: 'javascript:alert(1)',
        urlPrompt: 'tickets',
      })).rejects.toBeInstanceOf(InvalidExternalUrlError);
    });

    it('rejects create with a data: externalUrl via InvalidExternalUrlError', async () => {
      await expect(calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: { en: { name: 'Data URL' } },
        start_date: '2026-05-10',
        externalUrl: 'data:text/plain,hello',
        urlPrompt: 'tickets',
      })).rejects.toBeInstanceOf(InvalidExternalUrlError);
    });

    it('rejects create with externalUrl > 2048 chars via InvalidExternalUrlError', async () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2048);
      await expect(calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: { en: { name: 'Too Long' } },
        start_date: '2026-05-11',
        externalUrl: longUrl,
        urlPrompt: 'tickets',
      })).rejects.toBeInstanceOf(InvalidExternalUrlError);
    });

    it('rejects create with unknown urlPrompt via ValidationError on urlPrompt', async () => {
      const err = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: { en: { name: 'Bogus Prompt' } },
        start_date: '2026-05-12',
        externalUrl: 'https://example.com/',
        urlPrompt: 'hack',
      }).catch(e => e);

      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields).toBeDefined();
      expect((err as ValidationError).fields).toHaveProperty('urlPrompt');
    });
  });
});
