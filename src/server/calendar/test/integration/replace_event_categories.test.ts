/**
 * Integration regression for pv-bv78: replaceEventCategories must scope its
 * destroy to the acting calendar's assignments only.
 *
 * Category assignments link an event to a category, and each category is owned
 * by exactly one calendar (event_category.calendar_id, never reparented). A
 * reposted event is shared across multiple calendars, each of which may have
 * attached its own categories. The pre-fix code destroyed EVERY assignment for
 * the event before recreating the acting calendar's set, silently wiping the
 * source calendar's (and every other sharing calendar's) assignments.
 *
 * These tests run against a real DB (TestEnvironment) so row survival is
 * proven by direct DB queries — sinon unit stubs cannot prove that other
 * calendars' rows survive. Fixture conventions mirror
 * integration/listing_with_reposts.test.ts (EventRepostEntity for the repost
 * link) and integration/bulk_category_assignment.test.ts (two accounts /
 * calendars with their own categories).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { EventCategory } from '@/common/model/event_category';
import CalendarInterface from '@/server/calendar/interface';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { EventRepostEntity } from '@/server/calendar/entity/event_repost';
import { EventCategoryAssignmentEntity } from '@/server/calendar/entity/event_category_assignment';

describe('replaceEventCategories calendar-scoped destroy (pv-bv78)', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let eventBus: EventEmitter;

  let accountA: Account;
  let accountB: Account;
  let calendarA: Calendar;
  let calendarB: Calendar;
  let categoryA: EventCategory;
  let categoryB1: EventCategory;
  let categoryB2: EventCategory;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    // Minimal AP interface stub. resolveEffectiveCalendarId consults
    // getCalendarIdsForSharedEvent; the post-commit repostStatus lookup uses
    // getSharedEventStatusMap. The repost link under test is an
    // EventRepostEntity row (legacy table), so all AP stubs return empty.
    calendarInterface.setActivityPubInterface({
      getSharedEventStatusMap: async () => new Map<string, 'auto' | 'manual'>(),
      getCalendarIdsForSharedEvent: async () => [],
      getEventSourceActorUris: async () => new Map<string, string>(),
      findCalendarActorByCalendarId: async () => null,
    } as never);

    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const infoA = await accountService._setupAccount('replace-cat-a@pavillion.dev', 'testpassword');
    accountA = infoA.account;
    calendarA = await calendarInterface.createCalendar(accountA, 'replacecata');

    const infoB = await accountService._setupAccount('replace-cat-b@pavillion.dev', 'testpassword');
    accountB = infoB.account;
    calendarB = await calendarInterface.createCalendar(accountB, 'replacecatb');

    // Calendar A owns one category; Calendar B owns two.
    categoryA = await calendarInterface.createCategory(accountA, calendarA.id, {
      name: 'Source Category',
      language: 'en',
    });
    categoryB1 = await calendarInterface.createCategory(accountB, calendarB.id, {
      name: 'Reposter Category One',
      language: 'en',
    });
    categoryB2 = await calendarInterface.createCategory(accountB, calendarB.id, {
      name: 'Reposter Category Two',
      language: 'en',
    });
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    if (env) {
      await env.cleanup();
    }
  });

  /**
   * Build a fresh shared event: created on calendar A (with A's category
   * assigned), reposted to calendar B via an EventRepostEntity row, with one of
   * B's categories assigned. Returns the event id. Each test creates its own
   * event so prior replaces don't leak across cases.
   */
  async function createSharedEventWithBothAssignments(name: string): Promise<string> {
    const event: CalendarEvent = await calendarInterface.createEvent(accountA, {
      calendarId: calendarA.id,
      content: { en: { name, description: name } },
      start_date: '2026-09-01',
      start_time: '10:00',
      end_date: '2026-09-01',
      end_time: '11:00',
    });

    // Calendar A attaches its own category (as the source/owning calendar).
    await calendarInterface.replaceEventCategories(accountA, event.id, [categoryA.id]);

    // Calendar B reposts the event.
    await EventRepostEntity.create({
      id: uuidv4(),
      event_id: event.id,
      calendar_id: calendarB.id,
    });

    // Calendar B attaches one of its own categories to its view of the event.
    await calendarInterface.replaceEventCategories(accountB, event.id, [categoryB1.id]);

    return event.id;
  }

  async function assignmentCategoryIds(eventId: string): Promise<string[]> {
    const rows = await EventCategoryAssignmentEntity.findAll({
      where: { event_id: eventId },
      attributes: ['category_id'],
    });
    return rows.map(r => r.category_id);
  }

  it('leaves the source calendar A assignment intact when calendar B replaces its categories', async () => {
    const eventId = await createSharedEventWithBothAssignments('Shared Event - survival');

    // Sanity: both calendars' assignments exist before the replace.
    const before = await assignmentCategoryIds(eventId);
    expect(before).toEqual(expect.arrayContaining([categoryA.id, categoryB1.id]));

    // Calendar B replaces its categories (B1 -> B2). This must NOT touch A's row.
    await calendarInterface.replaceEventCategories(accountB, eventId, [categoryB2.id]);

    const after = await assignmentCategoryIds(eventId);
    // Calendar A's assignment survives.
    expect(after).toContain(categoryA.id);
    // Calendar B's own prior assignment (B1) is fully replaced by B2.
    expect(after).toContain(categoryB2.id);
    expect(after).not.toContain(categoryB1.id);
    // Exactly two assignments remain: A's category + B's new category.
    expect(after).toHaveLength(2);
  });

  it('clearing categories from calendar B removes only B assignments, not A', async () => {
    const eventId = await createSharedEventWithBothAssignments('Shared Event - clear');

    // Calendar B clears its categories (empty array).
    await calendarInterface.replaceEventCategories(accountB, eventId, []);

    const after = await assignmentCategoryIds(eventId);
    // A's assignment survives; B's is gone.
    expect(after).toEqual([categoryA.id]);
  });

  it('fully replaces the acting calendar A own prior assignments', async () => {
    // Calendar A (owning calendar) sets, then replaces, its own categories on a
    // non-reposted event. Proves the acting calendar's own set is still fully
    // replaced (no stale rows) after the scoping fix.
    const event = await calendarInterface.createEvent(accountA, {
      calendarId: calendarA.id,
      content: { en: { name: 'A own replace', description: 'A own replace' } },
      start_date: '2026-09-02',
      start_time: '10:00',
      end_date: '2026-09-02',
      end_time: '11:00',
    });

    const extraCategoryA = await calendarInterface.createCategory(accountA, calendarA.id, {
      name: 'Source Category Extra',
      language: 'en',
    });

    await calendarInterface.replaceEventCategories(accountA, event.id, [categoryA.id]);
    expect(await assignmentCategoryIds(event.id)).toEqual([categoryA.id]);

    await calendarInterface.replaceEventCategories(accountA, event.id, [extraCategoryA.id]);
    const after = await assignmentCategoryIds(event.id);
    expect(after).toEqual([extraCategoryA.id]);
  });

  it('does not delete other calendars assignments when the acting calendar owns zero categories', async () => {
    // Distinct from the caller passing an empty categoryIds array: here calendar
    // B owns NO categories at all, so the owned-id lookup returns empty and the
    // length guard skips the destroy entirely. A's assignment must survive, and
    // nothing must throw.
    const infoC = await (new AccountService(
      eventBus, new ConfigurationInterface(), new SetupInterface(),
    ))._setupAccount('replace-cat-c@pavillion.dev', 'testpassword');
    const accountC = infoC.account;
    const calendarC = await calendarInterface.createCalendar(accountC, 'replacecatc');

    const event = await calendarInterface.createEvent(accountA, {
      calendarId: calendarA.id,
      content: { en: { name: 'Zero-owned-categories', description: 'Zero-owned-categories' } },
      start_date: '2026-09-03',
      start_time: '10:00',
      end_date: '2026-09-03',
      end_time: '11:00',
    });
    await calendarInterface.replaceEventCategories(accountA, event.id, [categoryA.id]);

    // Calendar C reposts; C owns zero categories.
    await EventRepostEntity.create({
      id: uuidv4(),
      event_id: event.id,
      calendar_id: calendarC.id,
    });

    // Calendar C replaces with empty set. Owned-id lookup is empty -> destroy
    // skipped. A thrown error fails the test naturally; the row-survival
    // assertion below carries the meaningful check.
    await calendarInterface.replaceEventCategories(accountC, event.id, []);

    const after = await assignmentCategoryIds(event.id);
    expect(after).toEqual([categoryA.id]);
  });
});
