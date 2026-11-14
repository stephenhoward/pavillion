import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { ValidationError } from '@/common/exceptions/base';
import CalendarInterface from '@/server/calendar/interface';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { EventContentEntity } from '@/server/calendar/entity/event';
import { EventSeriesContentEntity } from '@/server/calendar/entity/event_series_content';
import { EventCategoryContentEntity } from '@/server/calendar/entity/event_category_content';
import { CalendarContentEntity } from '@/server/calendar/entity/calendar';
import { LocationContentEntity } from '@/server/calendar/entity/location_content';
import { LocationSpaceContentEntity } from '@/server/calendar/entity/location_space_content';
import { LocationSpaceEntity } from '@/server/calendar/entity/location_space';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * Integration tests for content language keys.
 *
 * Author-facing writes reject a key that is not a bare ISO 639-1 code, before
 * any row is written. Inbound federation folds a regional tag to its base
 * subtag and drops what does not fold, and the event still ingests.
 */
describe('Content language keys — write paths (integration)', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let testAccount: Account;
  let testCalendar: Calendar;
  let eventBus: EventEmitter;
  let counter = 0;

  async function expectLanguageRejection(promise: Promise<unknown>): Promise<void> {
    const error = await promise.then(() => null, (e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toHaveProperty('language');
  }

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    calendarInterface.setActivityPubInterface({
      getSharedEventStatusMap: async () => new Map(),
      findCalendarActorByCalendarId: async () => null,
    } as any);

    const accountService = new AccountService(eventBus, new ConfigurationInterface(), new SetupInterface());
    const info = await accountService._setupAccount('langcode@pavillion.dev', 'testpassword');
    testAccount = info.account;
    testCalendar = await calendarInterface.createCalendar(testAccount, 'langcodecalendar');
  });

  afterAll(async () => {
    eventBus?.removeAllListeners();
    await env.cleanup();
  });

  describe('author-facing writes', () => {
    it('rejects an invalid language on event create and writes no row', async () => {
      const name = `Lang Event ${++counter}`;
      await expectLanguageRejection(calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: { en: { name }, zz: { name: 'Bad' } },
        start_date: '2026-07-01',
      }));
      expect(await EventContentEntity.count({ where: { name } })).toBe(0);
    });

    it('rejects an invalid language on event update and leaves earlier languages unwritten', async () => {
      const created = await calendarInterface.createEvent(testAccount, {
        calendarId: testCalendar.id,
        content: { en: { name: 'Original' } },
        start_date: '2026-07-02',
      });
      await expectLanguageRejection(calendarInterface.updateEvent(testAccount, created.id, {
        content: { en: { name: 'Changed' }, 'fr-CA': { name: 'Bad' } },
      }));
      const rows = await EventContentEntity.findAll({ where: { event_id: created.id } });
      expect(rows.map((r) => r.name)).toEqual(['Original']);
    });

    it('rejects an invalid language on series create and writes no row', async () => {
      const name = `Lang Series ${++counter}`;
      await expectLanguageRejection(calendarInterface.createSeries(testAccount, testCalendar.id, {
        urlName: `langseries${counter}`,
        content: { en: { name }, constructor: { name: 'Bad' } },
      }));
      expect(await EventSeriesContentEntity.count({ where: { name } })).toBe(0);
    });

    it('rejects an invalid language on calendar settings and writes no row', async () => {
      const calendar = await calendarInterface.createCalendar(testAccount, `langsettings${++counter}`);
      await expectLanguageRejection(calendarInterface.updateCalendarSettings(testAccount, calendar.id, {
        content: { en: { name: 'Fine' }, und: { name: 'Bad' } },
      } as any));
      expect(await CalendarContentEntity.count({ where: { calendar_id: calendar.id, name: 'Fine' } })).toBe(0);
    });

    it('rejects an invalid language on category create and writes no row', async () => {
      const name = `Lang Category ${++counter}`;
      await expectLanguageRejection(calendarInterface.createCategory(testAccount, testCalendar.id, {
        content: { en: { name }, 'pt-BR': { name: 'Bad' } },
      }));
      expect(await EventCategoryContentEntity.count({ where: { name } })).toBe(0);
    });

    it('rejects an invalid language on category update', async () => {
      const category = await calendarInterface.createCategory(testAccount, testCalendar.id, {
        content: { en: { name: `Lang Cat Update ${++counter}` } },
      });
      await expectLanguageRejection(calendarInterface.updateCategory(testAccount, category.id, {
        content: { zz: { name: 'Bad' } },
      }, testCalendar.id));
    });
  });

  describe('inbound federation writes', () => {
    const remoteEventId = (n: number) => `https://peer.example/calendars/theirs/events/${n.toString(16).padStart(8, '0')}-2222-4222-8222-222222222222`;

    it('folds a regional tag and drops unknown codes while still ingesting the event', async () => {
      const content = JSON.parse(JSON.stringify({
        'fr-CA': { name: 'Salut' },
        zz: { name: 'Dropped' },
        en: { name: 'Hello' },
      }));
      Object.defineProperty(content, '__proto__', { value: { name: 'Proto' }, enumerable: true });

      const event = await calendarInterface.addRemoteEvent(testCalendar, { id: remoteEventId(1), content });

      const rows = await EventContentEntity.findAll({ where: { event_id: event.id } });
      expect(rows.map((r) => r.language).sort()).toEqual(['en', 'fr']);
      expect(rows.find((r) => r.language === 'fr')?.name).toBe('Salut');
    });

    it('keeps the exact key over a folded one on update', async () => {
      const event = await calendarInterface.addRemoteEvent(testCalendar, {
        id: remoteEventId(2),
        content: { en: { name: 'Hello' } },
      });
      await calendarInterface.updateRemoteEvent(testCalendar, {
        id: event.id,
        content: { 'fr-CA': { name: 'Folded' }, fr: { name: 'Exact' } },
      });
      const rows = await EventContentEntity.findAll({ where: { event_id: event.id, language: 'fr' } });
      expect(rows.map((r) => r.name)).toEqual(['Exact']);
    });

    it('folds place and space content language keys', async () => {
      const event = await calendarInterface.addRemoteEvent(testCalendar, {
        id: remoteEventId(3),
        content: { en: { name: 'Located' } },
        location: {
          name: 'Hall',
          originUri: 'https://peer.example/calendars/theirs/places/p1',
          content: { 'fr-CA': { accessibilityInfo: 'Accessible' }, zz: { accessibilityInfo: 'Dropped' } },
        },
        space: {
          originUri: 'https://peer.example/calendars/theirs/spaces/s1',
          content: { 'fr-CA': { name: 'Pièce', accessibilityInfo: '' }, zz: { name: 'Dropped', accessibilityInfo: '' } },
        },
      });
      expect(event.id).toBeTruthy();

      const placeRows = await LocationContentEntity.findAll();
      const placeLangs = placeRows.map((r) => r.language);
      expect(placeLangs).toContain('fr');
      expect(placeLangs).not.toContain('fr-CA');
      expect(placeLangs).not.toContain('zz');

      const spaceRows = await LocationSpaceContentEntity.findAll();
      const spaceLangs = spaceRows.map((r) => r.language);
      expect(spaceLangs).toContain('fr');
      expect(spaceLangs).not.toContain('fr-CA');
      expect(spaceLangs).not.toContain('zz');
      expect(await LocationSpaceEntity.count()).toBeGreaterThan(0);
    });
  });
});
