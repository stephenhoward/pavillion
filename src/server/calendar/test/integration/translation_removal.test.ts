import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { EventSeriesContentEntity } from '@/server/calendar/entity/event_series_content';
import { EventContentEntity } from '@/server/calendar/entity/event';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * Integration tests for removing a translation from a series or an event.
 *
 * The editor removes a language with `dropContent`, and the model serializes
 * that removal as a `null` entry in the content map. The update endpoints
 * treat the content map as a merge: a `null` entry deletes the stored row,
 * while a language that is simply absent is left alone (ICS re-sync sends a
 * single-language map and must not wipe hand-added translations).
 *
 * Content maps are built from the shared models' `toObject` so the tests
 * exercise the same wire contract the client sends.
 */
describe('Removing a translation (integration)', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let testAccount: Account;
  let testCalendar: Calendar;
  let eventBus: EventEmitter;
  let seriesCounter = 0;

  const nextUrlName = () => `series-drop-${++seriesCounter}`;

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

    const info = await accountService._setupAccount('translationremoval@pavillion.dev', 'testpassword');
    testAccount = info.account;
    testCalendar = await calendarInterface.createCalendar(testAccount, 'translationremovalcal');
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    await env.cleanup();
  });

  describe('series', () => {
    const createBilingualSeries = () => calendarInterface.createSeries(testAccount, testCalendar.id, {
      urlName: nextUrlName(),
      content: {
        en: { name: 'Summer Concerts', description: 'Outdoor concerts' },
        fr: { name: 'Concerts d\'été', description: 'Concerts en plein air' },
      },
    });

    it('deletes the stored row for a language dropped from the series', async () => {
      const created = await createBilingualSeries();

      const edited = await calendarInterface.getSeries(created.id);
      edited.dropContent('fr');
      const updated = await calendarInterface.updateSeries(testAccount, created.id, edited.toObject(), testCalendar.id);

      expect(updated.getLanguages()).toEqual(['en']);
      expect(await EventSeriesContentEntity.findOne({ where: { series_id: created.id, language: 'fr' } })).toBeNull();

      const reloaded = await calendarInterface.getSeries(created.id);
      expect(reloaded.getLanguages()).toEqual(['en']);
      expect(reloaded.content('en').name).toBe('Summer Concerts');
    });

    it('leaves a language that the payload omits untouched', async () => {
      const created = await createBilingualSeries();

      await calendarInterface.updateSeries(testAccount, created.id, {
        content: { en: { name: 'Summer Concerts 2026' } },
      }, testCalendar.id);

      const reloaded = await calendarInterface.getSeries(created.id);
      expect(reloaded.getLanguages().sort()).toEqual(['en', 'fr']);
      expect(reloaded.content('en').name).toBe('Summer Concerts 2026');
      expect(reloaded.content('fr').name).toBe('Concerts d\'été');
    });
  });

  describe('event', () => {
    const createBilingualEvent = () => calendarInterface.createEvent(testAccount, {
      calendarId: testCalendar.id,
      content: {
        en: { name: 'Concert', description: 'An evening concert' },
        fr: { name: 'Concert du soir', description: 'Un concert en soirée' },
      },
      start_date: '2026-07-01',
    });

    it('deletes the stored row for a language dropped from the event', async () => {
      const created = await createBilingualEvent();

      const edited = await calendarInterface.getEventById(created.id);
      edited.dropContent('fr');
      await calendarInterface.updateEvent(testAccount, created.id, {
        content: edited.toObject().content,
      });

      expect(await EventContentEntity.findOne({ where: { event_id: created.id, language: 'fr' } })).toBeNull();

      const reloaded = await calendarInterface.getEventById(created.id);
      expect(reloaded.getLanguages()).toEqual(['en']);
      expect(reloaded.content('en').name).toBe('Concert');
    });

    it('leaves a language that the payload omits untouched', async () => {
      const created = await createBilingualEvent();

      await calendarInterface.updateEvent(testAccount, created.id, {
        content: { en: { name: 'Concert 2026' } },
      });

      const reloaded = await calendarInterface.getEventById(created.id);
      expect(reloaded.getLanguages().sort()).toEqual(['en', 'fr']);
      expect(reloaded.content('en').name).toBe('Concert 2026');
      expect(reloaded.content('fr').name).toBe('Concert du soir');
    });
  });
});
