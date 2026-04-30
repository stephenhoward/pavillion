import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { DateTime } from 'luxon';

import { Calendar } from '@/common/model/calendar';
import { EventCategory } from '@/common/model/event_category';
import { CalendarEvent } from '@/common/model/events';
import CalendarEventInstance from '@/common/model/event_instance';
import CalendarInterface from '@/server/calendar/interface';
import PublicCalendarService from '@/server/public/service/calendar';

/**
 * Unit tests for PublicCalendarService.listCategoriesForCalendar option support.
 * Verifies that:
 *  - No options (legacy callers): per-category counts come from getCategoryEvents.
 *  - Date-range only / search-only / both: counts come from the canonical
 *    listEventInstancesWithFilters query, bucketed against each category's
 *    assigned event ids.
 */
describe('PublicCalendarService.listCategoriesForCalendar', () => {
  let sandbox: sinon.SinonSandbox;
  let calendarInterface: sinon.SinonStubbedInstance<CalendarInterface>;
  let service: PublicCalendarService;
  let calendar: Calendar;
  let category1: EventCategory;
  let category2: EventCategory;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    calendarInterface = sandbox.createStubInstance(CalendarInterface);
    service = new PublicCalendarService(calendarInterface as unknown as CalendarInterface);

    calendar = new Calendar('cal-id', 'test-calendar');
    category1 = new EventCategory('cat-1', 'cal-id');
    category2 = new EventCategory('cat-2', 'cal-id');

    calendarInterface.getCategories.resolves([category1, category2]);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('without options, returns counts from getCategoryEvents and does not query filtered instances', async () => {
    calendarInterface.getCategoryEvents.withArgs('cat-1').resolves(['e1', 'e2', 'e3']);
    calendarInterface.getCategoryEvents.withArgs('cat-2').resolves(['e4']);

    const result = await service.listCategoriesForCalendar(calendar);

    expect(result).toHaveLength(2);
    expect(result[0].category.id).toBe('cat-1');
    expect(result[0].eventCount).toBe(3);
    expect(result[1].category.id).toBe('cat-2');
    expect(result[1].eventCount).toBe(1);
    // Backward-compatibility check: the filtered query is not used in this path.
    expect(calendarInterface.listEventInstancesWithFilters.called).toBe(false);
  });

  it('with date range only, counts only events whose instances fall in the window', async () => {
    // Events assigned to each category.
    calendarInterface.getCategoryEvents.withArgs('cat-1').resolves(['e1', 'e2', 'e3']);
    calendarInterface.getCategoryEvents.withArgs('cat-2').resolves(['e4', 'e5']);

    // Filtered events from the canonical query — only e1, e3, e5 are in window.
    const inWindowInstances = [
      makeInstance('inst-a', 'e1'),
      makeInstance('inst-b', 'e3'),
      makeInstance('inst-c', 'e5'),
    ];
    calendarInterface.listEventInstancesWithFilters.resolves(inWindowInstances);

    const result = await service.listCategoriesForCalendar(calendar, {
      startDate: '2026-05-01',
      endDate: '2026-05-31',
    });

    expect(result).toHaveLength(2);
    expect(result[0].eventCount).toBe(2); // e1, e3 in window; e2 excluded
    expect(result[1].eventCount).toBe(1); // e5 in window; e4 excluded
    expect(calendarInterface.listEventInstancesWithFilters.calledOnce).toBe(true);
  });

  it('with search only, counts only events whose content matches the search', async () => {
    calendarInterface.getCategoryEvents.withArgs('cat-1').resolves(['e1', 'e2']);
    calendarInterface.getCategoryEvents.withArgs('cat-2').resolves(['e3', 'e4']);

    // Search returns e2 and e4 only.
    calendarInterface.listEventInstancesWithFilters.resolves([
      makeInstance('inst-a', 'e2'),
      makeInstance('inst-b', 'e4'),
    ]);

    const result = await service.listCategoriesForCalendar(calendar, {
      search: 'workshop',
    });

    expect(result[0].eventCount).toBe(1);
    expect(result[1].eventCount).toBe(1);
    expect(calendarInterface.listEventInstancesWithFilters.calledOnce).toBe(true);
  });

  it('with date range and search, composes both filters', async () => {
    calendarInterface.getCategoryEvents.withArgs('cat-1').resolves(['e1', 'e2', 'e3']);
    calendarInterface.getCategoryEvents.withArgs('cat-2').resolves(['e4', 'e5']);

    // Combined filter narrows to e2 only.
    calendarInterface.listEventInstancesWithFilters.resolves([
      makeInstance('inst-a', 'e2'),
    ]);

    const result = await service.listCategoriesForCalendar(calendar, {
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      search: 'workshop',
    });

    expect(result[0].eventCount).toBe(1); // only e2
    expect(result[1].eventCount).toBe(0); // none
    expect(calendarInterface.listEventInstancesWithFilters.calledOnce).toBe(true);
  });

  it('counts each event once per category even when multiple instances match (recurring events)', async () => {
    calendarInterface.getCategoryEvents.withArgs('cat-1').resolves(['e1']);
    calendarInterface.getCategoryEvents.withArgs('cat-2').resolves([]);

    // Recurring event e1 produces three instances in window.
    calendarInterface.listEventInstancesWithFilters.resolves([
      makeInstance('inst-a', 'e1'),
      makeInstance('inst-b', 'e1'),
      makeInstance('inst-c', 'e1'),
    ]);

    const result = await service.listCategoriesForCalendar(calendar, {
      startDate: '2026-05-01',
      endDate: '2026-05-31',
    });

    expect(result[0].eventCount).toBe(1);
    expect(result[1].eventCount).toBe(0);
  });

  it('rejects invalid startDate format without invoking the filtered query', async () => {
    await expect(
      service.listCategoriesForCalendar(calendar, { startDate: 'not-a-date' }),
    ).rejects.toThrow('Invalid date format');
    expect(calendarInterface.listEventInstancesWithFilters.called).toBe(false);
  });

  it('rejects invalid endDate format without invoking the filtered query', async () => {
    await expect(
      service.listCategoriesForCalendar(calendar, { endDate: '2026/05/31' }),
    ).rejects.toThrow('Invalid date format');
    expect(calendarInterface.listEventInstancesWithFilters.called).toBe(false);
  });

  it('rejects a date that matches the YYYY-MM-DD shape but is not a real calendar date', async () => {
    // 2026-02-30 passes the regex gate but Luxon's .isValid second gate rejects it.
    await expect(
      service.listCategoriesForCalendar(calendar, { startDate: '2026-02-30' }),
    ).rejects.toThrow('Invalid date format');
    expect(calendarInterface.listEventInstancesWithFilters.called).toBe(false);
  });
});

function makeInstance(instanceId: string, eventId: string): CalendarEventInstance {
  const event = new CalendarEvent(eventId, 'cal-id');
  return new CalendarEventInstance(instanceId, event, DateTime.now(), null);
}
