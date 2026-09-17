import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { CalendarContent } from '@/common/model/calendar';
import { ValidationError } from '@/common/exceptions/base';
import CalendarInterface from '@/server/calendar/interface';
import CalendarService from '@/server/calendar/service/calendar';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { IMAGE_ALT_MAX_LENGTH } from '@/server/calendar/service/image_alt';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * Integration tests for calendar content imageAlt — the alt text for a
 * calendar's default event image.
 *
 * Calendar content has no inbound federation writer, so every write path here
 * is author-facing and rejects rather than drops. Two doors are covered:
 * `updateCalendarSettings`, which the API calls, and `createCalendarContent`,
 * the model-shaped door beneath it that takes a whole CalendarContent — a
 * future caller building one from a request body must not be able to route
 * around the validator.
 */
describe('Calendar content imageAlt — write paths (integration)', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let calendarService: CalendarService;
  let testAccount: Account;
  let eventBus: EventEmitter;
  let calendarCounter = 0;

  const newCalendar = async () => {
    return calendarInterface.createCalendar(testAccount, `altcal${++calendarCounter}`);
  };

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    // A bare service instance is enough to reach createCalendarContent
    // directly; it touches neither the event bus nor any cross-domain
    // interface.
    calendarService = new CalendarService();

    calendarInterface.setActivityPubInterface({
      getSharedEventStatusMap: async () => new Map(),
      findCalendarActorByCalendarId: async () => null,
    } as any);

    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const info = await accountService._setupAccount('calendarimagealt@pavillion.dev', 'testpassword');
    testAccount = info.account;
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    await env.cleanup();
  });

  describe('updateCalendarSettings', () => {
    it('persists imageAlt per language and returns it on fetch', async () => {
      const calendar = await newCalendar();

      await calendarInterface.updateCalendarSettings(testAccount, calendar.id, {
        content: {
          en: { name: 'Illustrated Calendar', imageAlt: 'A banner of paper lanterns' },
          fr: { name: 'Calendrier illustré', imageAlt: 'Une bannière de lanternes' },
        },
      });

      const fetched = await calendarInterface.getCalendar(calendar.id);
      expect(fetched!.content('en').imageAlt).toBe('A banner of paper lanterns');
      expect(fetched!.content('fr').imageAlt).toBe('Une bannière de lanternes');
    });

    it('leaves imageAlt empty when the author supplies none', async () => {
      const calendar = await newCalendar();

      await calendarInterface.updateCalendarSettings(testAccount, calendar.id, {
        content: { en: { name: 'Decorative Calendar', description: 'No alt text' } },
      });

      const fetched = await calendarInterface.getCalendar(calendar.id);
      expect(fetched!.content('en').imageAlt).toBe('');
    });

    it('trims padding and strips markup, bidi and control characters', async () => {
      const calendar = await newCalendar();

      await calendarInterface.updateCalendarSettings(testAccount, calendar.id, {
        content: {
          en: { name: 'Hostile Alt Calendar', imageAlt: '  <b>Paper</b> lanterns‮  ' },
        },
      });

      const fetched = await calendarInterface.getCalendar(calendar.id);
      expect(fetched!.content('en').imageAlt).toBe('Paper lanterns');
    });

    it('rejects an over-long imageAlt', async () => {
      const calendar = await newCalendar();

      await expect(calendarInterface.updateCalendarSettings(testAccount, calendar.id, {
        content: { en: { name: 'Too Much Alt', imageAlt: 'a'.repeat(IMAGE_ALT_MAX_LENGTH + 1) } },
      })).rejects.toThrow(ValidationError);
    });

    it('rejects a non-string imageAlt', async () => {
      const calendar = await newCalendar();

      await expect(calendarInterface.updateCalendarSettings(testAccount, calendar.id, {
        content: { en: { name: 'Odd Alt', imageAlt: { en: 'nope' } as any } },
      })).rejects.toThrow(ValidationError);
    });

    it('updates imageAlt on an existing content row', async () => {
      const calendar = await newCalendar();

      await calendarInterface.updateCalendarSettings(testAccount, calendar.id, {
        content: { en: { name: 'Update Alt Calendar', imageAlt: 'Original alt text' } },
      });
      await calendarInterface.updateCalendarSettings(testAccount, calendar.id, {
        content: { en: { name: 'Update Alt Calendar', imageAlt: 'Corrected alt text' } },
      });

      const fetched = await calendarInterface.getCalendar(calendar.id);
      expect(fetched!.content('en').imageAlt).toBe('Corrected alt text');
    });

    it('clears imageAlt when a later update omits it', async () => {
      // Replace, not patch. The editor's Decorative toggle persists by sending
      // an empty alt text for every language, so an omitted value has to clear
      // the stored one rather than leave it in place.
      const calendar = await newCalendar();

      await calendarInterface.updateCalendarSettings(testAccount, calendar.id, {
        content: { en: { name: 'Clear Alt Calendar', imageAlt: 'Alt to be removed' } },
      });
      await calendarInterface.updateCalendarSettings(testAccount, calendar.id, {
        content: { en: { name: 'Clear Alt Calendar' } },
      });

      const fetched = await calendarInterface.getCalendar(calendar.id);
      expect(fetched!.content('en').imageAlt).toBe('');
    });

    it('keeps name and description on an imageAlt-only update', async () => {
      // The payload shape the alt editor produces: content[lang] carries
      // imageAlt and nothing else. The two field classes diverge here and both
      // halves matter — name and description are patch (guarded by
      // `!== undefined`, so omitting preserves), imageAlt is replace (omitting
      // clears, which is what makes the Decorative toggle persist). Reading the
      // settings update's own calendar row without its content would blank the
      // stored name and description with the empty strings of a fabricated
      // content model.
      const calendar = await newCalendar();

      await calendarInterface.updateCalendarSettings(testAccount, calendar.id, {
        content: {
          en: { name: 'Alt Only Calendar', description: 'A description worth keeping' },
        },
      });

      await calendarInterface.updateCalendarSettings(testAccount, calendar.id, {
        content: { en: { imageAlt: 'A banner of paper lanterns' } },
      });

      const fetched = await calendarInterface.getCalendar(calendar.id);
      expect(fetched!.content('en').name).toBe('Alt Only Calendar');
      expect(fetched!.content('en').description).toBe('A description worth keeping');
      expect(fetched!.content('en').imageAlt).toBe('A banner of paper lanterns');
    });

    it('writes nothing at all when a later language has an over-long imageAlt', async () => {
      // Rejection is all-or-nothing. updateCalendarSettings opens no
      // transaction and writes the calendar row before it reaches the content
      // loop, so validating per language would leave both the settings change
      // and the first language's content row committed under an error.
      const calendar = await newCalendar();

      await calendarInterface.updateCalendarSettings(testAccount, calendar.id, {
        defaultDateRange: '1week',
        content: { en: { name: 'Partial Write Calendar', imageAlt: 'Original alt text' } },
      });

      await expect(calendarInterface.updateCalendarSettings(testAccount, calendar.id, {
        defaultDateRange: '2weeks',
        content: {
          en: { name: 'Partial Write Renamed', imageAlt: 'Corrected alt text' },
          fr: { name: 'Calendrier partiel', imageAlt: 'a'.repeat(IMAGE_ALT_MAX_LENGTH + 1) },
        },
      })).rejects.toThrow(ValidationError);

      const fetched = await calendarInterface.getCalendar(calendar.id);
      expect(fetched!.defaultDateRange).toBe('1week');
      expect(fetched!.content('en').name).toBe('Partial Write Calendar');
      expect(fetched!.content('en').imageAlt).toBe('Original alt text');
      // hasContent, not content(): TranslatedModel.content() lazily fabricates
      // an empty instance for a missing language, so it cannot prove absence.
      expect(fetched!.hasContent('fr')).toBe(false);
    });
  });

  describe('createCalendarContent — the model-shaped door', () => {
    it('normalizes imageAlt on a newly created content row', async () => {
      // This door takes a whole CalendarContent, not a field list, so a caller
      // that built one from a request body would reach the column directly.
      const calendar = await newCalendar();
      const content = new CalendarContent('en', 'Direct Door Calendar');
      content.imageAlt = '  <b>Paper</b> lanterns​  ';

      await calendarService.createCalendarContent(calendar.id, content);

      const fetched = await calendarInterface.getCalendar(calendar.id);
      expect(fetched!.content('en').imageAlt).toBe('Paper lanterns');
    });

    it('normalizes imageAlt when updating an existing content row', async () => {
      const calendar = await newCalendar();
      const first = new CalendarContent('en', 'Direct Door Calendar');
      first.imageAlt = 'Original alt text';
      await calendarService.createCalendarContent(calendar.id, first);

      const second = new CalendarContent('en', 'Direct Door Calendar');
      second.imageAlt = '  <i>Paper</i> lanterns  ';
      await calendarService.createCalendarContent(calendar.id, second);

      const fetched = await calendarInterface.getCalendar(calendar.id);
      expect(fetched!.content('en').imageAlt).toBe('Paper lanterns');
    });

    it('rejects an over-long imageAlt on both branches', async () => {
      const calendar = await newCalendar();
      const tooLong = new CalendarContent('en', 'Direct Door Calendar');
      tooLong.imageAlt = 'a'.repeat(IMAGE_ALT_MAX_LENGTH + 1);

      // Create branch: no row exists yet for this language.
      await expect(calendarService.createCalendarContent(calendar.id, tooLong))
        .rejects.toThrow(ValidationError);

      const valid = new CalendarContent('en', 'Direct Door Calendar');
      valid.imageAlt = 'Original alt text';
      await calendarService.createCalendarContent(calendar.id, valid);

      // Update branch: a row now exists, and it must be guarded the same way.
      await expect(calendarService.createCalendarContent(calendar.id, tooLong))
        .rejects.toThrow(ValidationError);

      const fetched = await calendarInterface.getCalendar(calendar.id);
      expect(fetched!.content('en').imageAlt).toBe('Original alt text');
    });
  });
});
