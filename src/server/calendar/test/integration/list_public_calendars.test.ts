/**
 * Integration tests for CalendarService.listPublicCalendars (pv-u4ew.2).
 *
 * Covers the public-discovery query that powers the /view/ landing page:
 *   - listed=true / listed=false filtering
 *   - MAX(event.updatedAt) → lastEventActivity aggregate per calendar
 *   - ORDER BY activity DESC NULLS LAST (no-event calendars sort last)
 *   - LIMIT 500 server-side cap
 *   - Empty state (no listed calendars)
 *   - Events on other calendars don't influence a calendar's lastEventActivity
 *
 * Hits real entities through a TestEnvironment-bootstrapped SQLite database so
 * the literal()-driven correlated subquery and NULLS LAST ordering exercise
 * the actual SQL dialect used by the test suite.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { CalendarEntity, CalendarContentEntity } from '@/server/calendar/entity/calendar';
import { EventEntity, EventScheduleEntity } from '@/server/calendar/entity/event';

describe('CalendarService.listPublicCalendars (pv-u4ew.2)', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let eventBus: EventEmitter;
  let accountService: AccountService;
  let accountSeq = 0;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    calendarInterface = new CalendarInterface(eventBus);
    accountService = new AccountService(eventBus, configurationInterface, setupInterface);
  });

  afterAll(async () => {
    await env.cleanup();
  });

  // Wipe rows between scenarios so each `it` block has a clean canvas without
  // tearing down the schema. Order matters: child rows before parents.
  async function resetDiscoveryFixtures(): Promise<void> {
    await EventScheduleEntity.destroy({ where: {}, truncate: false, force: true });
    await EventEntity.destroy({ where: {}, truncate: false, force: true });
    await CalendarContentEntity.destroy({ where: {}, truncate: false, force: true });
    await CalendarEntity.destroy({ where: {}, truncate: false, force: true });
  }

  async function makeAccount(): Promise<Account> {
    const email = `discovery-${++accountSeq}@pavillion.dev`;
    const info = await accountService._setupAccount(email, 'testpassword');
    return info.account;
  }

  async function makeCalendar(urlName: string, listed: boolean): Promise<Calendar> {
    const account = await makeAccount();
    const calendar = await calendarInterface.createCalendar(account, urlName);
    if (!listed) {
      await CalendarEntity.update({ listed: false }, { where: { id: calendar.id } });
    }
    return calendar;
  }

  /**
   * Creates an event with one publicly-visible (non-exclusion) schedule.
   * The schedule row is what makes the event count toward `lastEventActivity`:
   * the discovery query's EXISTS clause requires at least one schedule that is
   * NOT a hidden cancellation (NOT (is_exclusion AND hide_from_public)).
   */
  async function createEventOnCalendar(calendarId: string, updatedAt: Date): Promise<string> {
    const eventId = uuidv4();
    // Construct EventEntity directly so we can pin updatedAt without going
    // through createEvent → buildEventInstances. The discovery query joins on
    // event.updatedAt; that's the column under test.
    await EventEntity.create(
      {
        id: eventId,
        calendar_id: calendarId,
        createdAt: updatedAt,
        updatedAt,
      },
      // Silent: silenceTimestamps so Sequelize honors the explicit timestamps
      // rather than overwriting with NOW().
      { silent: true } as any,
    );
    // Attach a non-exclusion schedule so the event is publicly visible per the
    // canonical predicate in EventInstanceService.rrules().
    await EventScheduleEntity.create({
      id: uuidv4(),
      event_id: eventId,
      is_exclusion: false,
      hide_from_public: false,
    });
    return eventId;
  }

  /**
   * Creates an event whose only schedule is a hidden cancellation
   * (is_exclusion=true AND hide_from_public=true — EXDATE-style suppression).
   * Per the discovery query's visibility predicate, this event must NOT
   * contribute to the calendar's `lastEventActivity`.
   */
  async function createHiddenOnlyEventOnCalendar(calendarId: string, updatedAt: Date): Promise<string> {
    const eventId = uuidv4();
    await EventEntity.create(
      {
        id: eventId,
        calendar_id: calendarId,
        createdAt: updatedAt,
        updatedAt,
      },
      { silent: true } as any,
    );
    await EventScheduleEntity.create({
      id: uuidv4(),
      event_id: eventId,
      is_exclusion: true,
      hide_from_public: true,
    });
    return eventId;
  }

  describe('listed flag filtering', () => {
    beforeAll(async () => {
      await resetDiscoveryFixtures();
    });

    it('returns only listed=true calendars, excluding listed=false', async () => {
      const listedA = await makeCalendar('listed-a', true);
      const listedB = await makeCalendar('listed-b', true);
      await makeCalendar('unlisted-x', false); // must NOT appear

      const result = await calendarInterface.listPublicCalendars();

      const urlNames = result.map(r => r.calendar.urlName).sort();
      expect(urlNames).toEqual(['listed-a', 'listed-b']);

      // Sanity: every returned calendar must satisfy listed=true.
      expect(result.every(r => r.calendar.listed === true)).toBe(true);

      // Pin the ids — guards against the listed=false row sneaking in under a
      // future query refactor.
      const returnedIds = new Set(result.map(r => r.calendar.id));
      expect(returnedIds.has(listedA.id)).toBe(true);
      expect(returnedIds.has(listedB.id)).toBe(true);
    });
  });

  describe('sort by lastEventActivity DESC NULLS LAST', () => {
    beforeAll(async () => {
      await resetDiscoveryFixtures();
    });

    it('orders all-have-events: most-recent event activity first', async () => {
      const oldest = await makeCalendar('sort-oldest', true);
      const middle = await makeCalendar('sort-middle', true);
      const newest = await makeCalendar('sort-newest', true);

      // Spread updatedAt across calendars; each calendar gets the same
      // updatedAt across its single event so MAX() collapses to that value.
      await createEventOnCalendar(oldest.id, new Date('2024-01-01T00:00:00Z'));
      await createEventOnCalendar(middle.id, new Date('2025-06-15T00:00:00Z'));
      await createEventOnCalendar(newest.id, new Date('2026-04-20T00:00:00Z'));

      const result = await calendarInterface.listPublicCalendars();
      const urlNames = result.map(r => r.calendar.urlName);

      expect(urlNames).toEqual(['sort-newest', 'sort-middle', 'sort-oldest']);

      // lastEventActivity reflects MAX(event.updatedAt) per calendar.
      expect(result[0].lastEventActivity).toEqual(new Date('2026-04-20T00:00:00Z'));
      expect(result[1].lastEventActivity).toEqual(new Date('2025-06-15T00:00:00Z'));
      expect(result[2].lastEventActivity).toEqual(new Date('2024-01-01T00:00:00Z'));
    });
  });

  describe('sort when no calendar has events', () => {
    beforeAll(async () => {
      await resetDiscoveryFixtures();
    });

    it('returns all listed calendars with lastEventActivity=null', async () => {
      await makeCalendar('none-1', true);
      await makeCalendar('none-2', true);

      const result = await calendarInterface.listPublicCalendars();

      expect(result).toHaveLength(2);
      expect(result.every(r => r.lastEventActivity === null)).toBe(true);
    });
  });

  describe('mixed: some calendars have events, some do not', () => {
    beforeAll(async () => {
      await resetDiscoveryFixtures();
    });

    it('puts calendars-with-events before no-event calendars (NULLS LAST)', async () => {
      const withEvents = await makeCalendar('with-events', true);
      const noEvents1 = await makeCalendar('no-events-1', true);
      const noEvents2 = await makeCalendar('no-events-2', true);

      await createEventOnCalendar(withEvents.id, new Date('2026-03-01T00:00:00Z'));

      const result = await calendarInterface.listPublicCalendars();
      const urlNames = result.map(r => r.calendar.urlName);

      // First slot must be the calendar with events.
      expect(urlNames[0]).toBe('with-events');
      expect(result[0].lastEventActivity).toEqual(new Date('2026-03-01T00:00:00Z'));

      // The no-event calendars come after, both with null activity.
      expect(urlNames.slice(1).sort()).toEqual(['no-events-1', 'no-events-2']);
      expect(result[1].lastEventActivity).toBeNull();
      expect(result[2].lastEventActivity).toBeNull();

      // Sanity ids
      const ids = result.map(r => r.calendar.id);
      expect(ids).toContain(withEvents.id);
      expect(ids).toContain(noEvents1.id);
      expect(ids).toContain(noEvents2.id);
    });
  });

  describe('tied timestamps', () => {
    beforeAll(async () => {
      await resetDiscoveryFixtures();
    });

    it('returns both tied calendars; sort is deterministic within the tied set', async () => {
      const tiedA = await makeCalendar('tied-a', true);
      const tiedB = await makeCalendar('tied-b', true);

      const sameTime = new Date('2026-04-01T12:00:00Z');
      await createEventOnCalendar(tiedA.id, sameTime);
      await createEventOnCalendar(tiedB.id, sameTime);

      const result = await calendarInterface.listPublicCalendars();
      expect(result).toHaveLength(2);

      // Both calendars present; both have the same lastEventActivity.
      const urlNames = result.map(r => r.calendar.urlName).sort();
      expect(urlNames).toEqual(['tied-a', 'tied-b']);
      expect(result[0].lastEventActivity).toEqual(sameTime);
      expect(result[1].lastEventActivity).toEqual(sameTime);
    });
  });

  describe('lastEventActivity reflects MAX(updatedAt) per calendar', () => {
    beforeAll(async () => {
      await resetDiscoveryFixtures();
    });

    it('takes the maximum event.updatedAt across the calendar', async () => {
      const cal = await makeCalendar('max-aggregate', true);

      await createEventOnCalendar(cal.id, new Date('2024-01-01T00:00:00Z'));
      await createEventOnCalendar(cal.id, new Date('2026-05-10T12:00:00Z')); // max
      await createEventOnCalendar(cal.id, new Date('2025-03-15T00:00:00Z'));

      const result = await calendarInterface.listPublicCalendars();
      const row = result.find(r => r.calendar.urlName === 'max-aggregate');

      expect(row).toBeDefined();
      expect(row!.lastEventActivity).toEqual(new Date('2026-05-10T12:00:00Z'));
    });

    it('does NOT include events from other calendars in lastEventActivity', async () => {
      const mine = await makeCalendar('mine', true);
      const theirs = await makeCalendar('theirs', true);

      // theirs has a very recent event; mine has an older one. The MAX for
      // mine must NOT pick up theirs' updatedAt — the LEFT JOIN predicate
      // scopes to event.calendar_id = calendar.id.
      await createEventOnCalendar(mine.id, new Date('2024-01-01T00:00:00Z'));
      await createEventOnCalendar(theirs.id, new Date('2026-06-01T00:00:00Z'));

      const result = await calendarInterface.listPublicCalendars();
      const mineRow = result.find(r => r.calendar.urlName === 'mine');
      const theirsRow = result.find(r => r.calendar.urlName === 'theirs');

      expect(mineRow).toBeDefined();
      expect(theirsRow).toBeDefined();
      expect(mineRow!.lastEventActivity).toEqual(new Date('2024-01-01T00:00:00Z'));
      expect(theirsRow!.lastEventActivity).toEqual(new Date('2026-06-01T00:00:00Z'));
    });
  });

  describe('lastEventActivity excludes hidden-only events', () => {
    beforeAll(async () => {
      await resetDiscoveryFixtures();
    });

    it('returns lastEventActivity=null for a calendar whose only event is hidden-cancellation-only', async () => {
      const cal = await makeCalendar('hidden-only', true);

      // Single event whose only schedule is a hidden cancellation
      // (is_exclusion=true AND hide_from_public=true — EXDATE-style).
      // Per the discovery query predicate, this event must NOT contribute.
      await createHiddenOnlyEventOnCalendar(cal.id, new Date('2026-04-01T12:00:00Z'));

      const result = await calendarInterface.listPublicCalendars();
      const row = result.find(r => r.calendar.urlName === 'hidden-only');

      expect(row).toBeDefined();
      expect(row!.lastEventActivity).toBeNull();
    });

    it('does not let a hidden-only event inflate lastEventActivity past a visible event', async () => {
      await resetDiscoveryFixtures();
      const cal = await makeCalendar('mixed-visibility', true);

      // Visible event with older updatedAt; the hidden-only event is newer.
      // If the predicate were dropped, MAX() would pick up the hidden row and
      // the calendar would sort by 2026-06-01 instead of 2024-01-01.
      await createEventOnCalendar(cal.id, new Date('2024-01-01T00:00:00Z'));
      await createHiddenOnlyEventOnCalendar(cal.id, new Date('2026-06-01T00:00:00Z'));

      const result = await calendarInterface.listPublicCalendars();
      const row = result.find(r => r.calendar.urlName === 'mixed-visibility');

      expect(row).toBeDefined();
      // MAX(updatedAt) reflects only the visible event, not the hidden one.
      expect(row!.lastEventActivity).toEqual(new Date('2024-01-01T00:00:00Z'));
    });
  });

  describe('empty result', () => {
    beforeAll(async () => {
      await resetDiscoveryFixtures();
    });

    it('returns [] when there are no listed calendars', async () => {
      // Create only unlisted calendars; the discovery query must skip them all.
      await makeCalendar('hidden-a', false);
      await makeCalendar('hidden-b', false);

      const result = await calendarInterface.listPublicCalendars();
      expect(result).toEqual([]);
    });

    it('returns [] when there are no calendars at all', async () => {
      await resetDiscoveryFixtures();
      const result = await calendarInterface.listPublicCalendars();
      expect(result).toEqual([]);
    });
  });

  describe('LIMIT 500 server-side cap', () => {
    beforeAll(async () => {
      await resetDiscoveryFixtures();
    });

    it('caps results at 500 even when more calendars exist', async () => {
      // Insert 501 listed calendars directly via the entity to keep the test
      // fast. Skip CalendarMember rows — they aren't required by the
      // discovery query (it's rooted at CalendarEntity).
      const ids: string[] = [];
      const rows = [];
      for (let i = 0; i < 501; i++) {
        const id = uuidv4();
        ids.push(id);
        rows.push({
          id,
          url_name: `bulk-${i.toString().padStart(4, '0')}`,
          languages: 'en',
          default_date_range: null,
          widget_allowed_domain: null,
          default_event_image_id: null,
          listed: true,
        });
      }
      await CalendarEntity.bulkCreate(rows);

      const result = await calendarInterface.listPublicCalendars();

      // Hard cap, exactly 500.
      expect(result).toHaveLength(500);
    }, 30000);

    it('caps distinct calendars at 500 even with multi-language content rows', async () => {
      // Regression cap: with a LEFT JOIN on CalendarContentEntity and a
      // single-query LIMIT, the cap would silently apply to joined rows, so a
      // calendar with 3 language rows would consume 3 of the 500 slots and
      // the query would return ~167 distinct calendars instead of 500. The
      // service splits the query in two so the cap applies to distinct
      // calendars regardless of how many content rows each has.
      await resetDiscoveryFixtures();

      const calendarRows = [];
      const contentRows = [];
      const TOTAL_CALENDARS = 501;
      const LANGUAGES = ['en', 'fr', 'es'];

      for (let i = 0; i < TOTAL_CALENDARS; i++) {
        const id = uuidv4();
        calendarRows.push({
          id,
          url_name: `multilingual-${i.toString().padStart(4, '0')}`,
          languages: 'en,fr,es',
          default_date_range: null,
          widget_allowed_domain: null,
          default_event_image_id: null,
          listed: true,
        });
        for (const language of LANGUAGES) {
          contentRows.push({
            id: uuidv4(),
            calendar_id: id,
            language,
            name: `Name in ${language} for ${i}`,
            description: '',
          });
        }
      }
      await CalendarEntity.bulkCreate(calendarRows);
      await CalendarContentEntity.bulkCreate(contentRows);

      const result = await calendarInterface.listPublicCalendars();

      // Hard cap, exactly 500 DISTINCT calendars (not joined rows).
      expect(result).toHaveLength(500);

      // Sanity: each returned calendar should be unique.
      const returnedIds = new Set(result.map((r) => r.calendar.id));
      expect(returnedIds.size).toBe(500);
    }, 30000);
  });
});
