/**
 * Tests for the shared MonthView grid.
 *
 * The grid is presentational: events arrive bucketed by local ISO date, links
 * come from the caller's route builders, and labels follow the active locale.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DateTime } from 'luxon';

import MonthView from '@/common/ui/calendar-views/MonthView.vue';
import { initI18n, makeInstance, mountGrid, routeBuilders } from './grid-harness';

// March 2025 begins on a Saturday, so its grid runs Sunday 2025-02-23 through
// Saturday 2025-04-05.
const ANCHOR = DateTime.local(2025, 3, 12);

function at(day: number, hour = 9) {
  return DateTime.local(2025, 3, day, hour);
}

describe('MonthView', () => {
  beforeEach(async () => {
    await initI18n('en');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders 42 day cells, padding the month with its neighbours', async () => {
    const wrapper = await mountGrid(MonthView, {
      anchorDate: ANCHOR, eventsByDay: {}, isLoading: false, ...routeBuilders(),
    });

    expect(wrapper.find('.month-view .month-grid').exists()).toBe(true);
    const cells = wrapper.findAll('.month-day-cell');
    expect(cells).toHaveLength(42);
    expect(cells[0].classes()).toContain('is-other-month');
    expect(cells[0].find('.day-number').text()).toBe('23');
    expect(cells[6].classes()).not.toContain('is-other-month');
    expect(cells[6].find('.day-number').text()).toBe('1');
    expect(cells[41].find('.day-number').text()).toBe('5');
  });

  it('shows three events and an overflow chip counting the rest at four events', async () => {
    const events = ['a', 'b', 'c', 'd', 'e'].map((id, i) => makeInstance(id, at(10, 9 + i)));
    const builders = routeBuilders();
    const wrapper = await mountGrid(MonthView, {
      anchorDate: ANCHOR, eventsByDay: { '2025-03-10': events }, isLoading: false, ...builders,
    });

    const cell = wrapper.findAll('.month-day-cell').find(node => node.find('.event-item').exists())!;
    expect(cell.classes()).toContain('has-events');
    expect(cell.findAll('.event-item')).toHaveLength(3);
    const overflow = cell.find('.event-overflow');
    expect(overflow.text()).toBe('2 more events');
    expect(builders.dayRoute).toHaveBeenCalledWith('2025-03-10');
    expect(overflow.attributes('href')).toBe('/mycal?date=2025-03-10');
  });

  it('shows no overflow chip at exactly three events', async () => {
    const events = ['a', 'b', 'c'].map(id => makeInstance(id, at(10)));
    const wrapper = await mountGrid(MonthView, {
      anchorDate: ANCHOR, eventsByDay: { '2025-03-10': events }, isLoading: false, ...routeBuilders(),
    });

    expect(wrapper.findAll('.event-item')).toHaveLength(3);
    expect(wrapper.find('.event-overflow').exists()).toBe(false);
  });

  it('renders no events in the padding days from neighbouring months', async () => {
    const wrapper = await mountGrid(MonthView, {
      anchorDate: ANCHOR,
      eventsByDay: {
        '2025-02-24': [makeInstance('feb', DateTime.local(2025, 2, 24, 9))],
        '2025-04-02': [makeInstance('apr', DateTime.local(2025, 4, 2, 9))],
      },
      isLoading: false,
      ...routeBuilders(),
    });

    const padding = wrapper.findAll('.month-day-cell.is-other-month');
    expect(padding).toHaveLength(11);
    for (const cell of padding) {
      expect(cell.find('.event-item').exists()).toBe(false);
      expect(cell.find('a').exists()).toBe(false);
    }
  });

  it('builds event and day links from the route props', async () => {
    const instance = makeInstance('a', at(11));
    const builders = routeBuilders();
    const wrapper = await mountGrid(MonthView, {
      anchorDate: ANCHOR, eventsByDay: { '2025-03-11': [instance] }, isLoading: false, ...builders,
    });

    expect(builders.eventRoute).toHaveBeenCalledWith(instance);
    expect(wrapper.find('a.event-item').attributes('href')).toBe('/mycal/events/event-a');
    const times = wrapper.findAll('.event-time');
    expect(times).toHaveLength(1);
    expect(times[0].text()).toMatch(/^9:00\sAM$/);

    // 2025-03-11 is the 17th cell: six days of February padding, then March 1..11.
    const dayLink = wrapper.findAll('.month-day-cell')[16].find('a.day-number');
    expect(dayLink.attributes('href')).toBe('/mycal?date=2025-03-11');
  });

  it('marks today and gives its day link aria-current', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 2, 13, 12));
    const wrapper = await mountGrid(MonthView, {
      anchorDate: ANCHOR, eventsByDay: {}, isLoading: false, ...routeBuilders(),
    });

    const todayCells = wrapper.findAll('.month-day-cell.is-today');
    expect(todayCells).toHaveLength(1);
    expect(todayCells[0].find('.day-number').text()).toBe('13');
    expect(todayCells[0].find('.day-number').attributes('aria-current')).toBe('date');
  });

  it.each(['es', 'fr'])('labels the weekday headers with Luxon weekdays in %s', async (language) => {
    await initI18n(language);
    const wrapper = await mountGrid(MonthView, {
      anchorDate: ANCHOR, eventsByDay: {}, isLoading: false, ...routeBuilders(),
    });

    // 2025-03-09 is a Sunday, so these are Sunday through Saturday.
    const expected = Array.from({ length: 7 }, (_, i) =>
      DateTime.local(2025, 3, 9 + i).setLocale(language).toFormat('ccc'));
    expect(wrapper.findAll('.weekday-header').map(node => node.text())).toEqual(expected);
  });

  it('resolves event titles in the active language', async () => {
    await initI18n('fr');
    const instance = makeInstance('a', at(12), { en: 'Concert', fr: 'Concert du soir' });
    const wrapper = await mountGrid(MonthView, {
      anchorDate: ANCHOR, eventsByDay: { '2025-03-12': [instance] }, isLoading: false, ...routeBuilders(),
    });

    expect(wrapper.find('.event-name').text()).toBe('Concert du soir');
  });

  it('shows the empty state when the month has no events and nothing is loading', async () => {
    const wrapper = await mountGrid(MonthView, {
      anchorDate: ANCHOR,
      // A padding day's events do not count towards the displayed month.
      eventsByDay: { '2025-04-02': [makeInstance('a', DateTime.local(2025, 4, 2, 9))] },
      isLoading: false,
      ...routeBuilders(),
    });

    expect(wrapper.find('.ui-empty-state').text()).toBe('No events this month');
  });

  it('shows loading rather than the empty state while loading', async () => {
    const wrapper = await mountGrid(MonthView, {
      anchorDate: ANCHOR, eventsByDay: {}, isLoading: true, ...routeBuilders(),
    });

    expect(wrapper.find('.ui-empty-state').exists()).toBe(false);
    expect(wrapper.find('[role="status"]').text()).toBe('Loading...');
  });

  it('shows no empty state when the month has events', async () => {
    const wrapper = await mountGrid(MonthView, {
      anchorDate: ANCHOR,
      eventsByDay: { '2025-03-12': [makeInstance('a', at(12))] },
      isLoading: false,
      ...routeBuilders(),
    });

    expect(wrapper.find('.ui-empty-state').exists()).toBe(false);
    expect(wrapper.find('[role="status"]').text()).toBe('');
  });
});
