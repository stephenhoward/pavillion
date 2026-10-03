/**
 * Tests for the shared WeekView grid.
 *
 * The grid is presentational: events arrive bucketed by local ISO date, links
 * come from the caller's route builders, and labels follow the active locale.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DateTime } from 'luxon';

import WeekView from '@/common/ui/calendar-views/WeekView.vue';
import { initI18n, makeInstance, mountGrid, routeBuilders } from './grid-harness';

// Wednesday; its week runs Sunday 2025-03-09 through Saturday 2025-03-15.
const ANCHOR = DateTime.local(2025, 3, 12);

function at(day: number, hour = 9) {
  return DateTime.local(2025, 3, day, hour);
}

describe('WeekView', () => {
  beforeEach(async () => {
    await initI18n('en');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders seven day columns, Sunday first', async () => {
    const wrapper = await mountGrid(WeekView, {
      anchorDate: ANCHOR, eventsByDay: {}, isLoading: false, ...routeBuilders(),
    });

    expect(wrapper.find('.week-view .week-grid').exists()).toBe(true);
    const columns = wrapper.findAll('.week-day-column');
    expect(columns).toHaveLength(7);
    expect(columns[0].find('.day-number').text()).toBe('9');
    expect(columns[6].find('.day-number').text()).toBe('15');
  });

  it('shows three events and an overflow chip counting the rest at four events', async () => {
    const events = ['a', 'b', 'c', 'd'].map((id, i) => makeInstance(id, at(10, 9 + i)));
    const builders = routeBuilders();
    const wrapper = await mountGrid(WeekView, {
      anchorDate: ANCHOR, eventsByDay: { '2025-03-10': events }, isLoading: false, ...builders,
    });

    const monday = wrapper.findAll('.week-day-column')[1];
    expect(monday.findAll('.event-item')).toHaveLength(3);
    const overflow = monday.find('.event-overflow');
    expect(overflow.text()).toBe('1 more event');
    expect(builders.dayRoute).toHaveBeenCalledWith('2025-03-10');
    expect(overflow.attributes('href')).toBe('/mycal?date=2025-03-10');
  });

  it('shows no overflow chip at three events', async () => {
    const events = ['a', 'b', 'c'].map(id => makeInstance(id, at(10)));
    const wrapper = await mountGrid(WeekView, {
      anchorDate: ANCHOR, eventsByDay: { '2025-03-10': events }, isLoading: false, ...routeBuilders(),
    });

    expect(wrapper.find('.event-overflow').exists()).toBe(false);
  });

  it('builds event and day links from the route props', async () => {
    const instance = makeInstance('a', at(11));
    const builders = routeBuilders();
    const wrapper = await mountGrid(WeekView, {
      anchorDate: ANCHOR, eventsByDay: { '2025-03-11': [instance] }, isLoading: false, ...builders,
    });

    expect(builders.eventRoute).toHaveBeenCalledWith(instance);
    expect(wrapper.find('a.event-item').attributes('href')).toBe('/mycal/events/event-a');
    const times = wrapper.findAll('.event-time');
    expect(times).toHaveLength(1);
    expect(times[0].text()).toMatch(/^9:00\sAM$/);

    expect(builders.dayRoute).toHaveBeenCalledWith('2025-03-09');
    const dayLink = wrapper.findAll('.week-day-column')[2].find('a.day-number');
    expect(dayLink.attributes('href')).toBe('/mycal?date=2025-03-11');
  });

  it('marks today and gives its day link aria-current', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 2, 13, 12));
    const wrapper = await mountGrid(WeekView, {
      anchorDate: ANCHOR, eventsByDay: {}, isLoading: false, ...routeBuilders(),
    });

    const todayColumns = wrapper.findAll('.week-day-column.is-today');
    expect(todayColumns).toHaveLength(1);
    expect(todayColumns[0].find('.day-number').text()).toBe('13');
    expect(todayColumns[0].find('.day-number').attributes('aria-current')).toBe('date');
    expect(wrapper.findAll('[aria-current]')).toHaveLength(1);
  });

  it('renders no event list for a day without events', async () => {
    const wrapper = await mountGrid(WeekView, {
      anchorDate: ANCHOR,
      eventsByDay: { '2025-03-12': [makeInstance('a', at(12))] },
      isLoading: false,
      ...routeBuilders(),
    });

    expect(wrapper.findAll('.day-events')).toHaveLength(1);
  });

  it.each(['es', 'fr'])('labels the columns with Luxon weekdays in %s', async (language) => {
    await initI18n(language);
    const wrapper = await mountGrid(WeekView, {
      anchorDate: ANCHOR, eventsByDay: {}, isLoading: false, ...routeBuilders(),
    });

    // 2025-03-09 is a Sunday, so these are Sunday through Saturday.
    const expected = Array.from({ length: 7 }, (_, i) =>
      DateTime.local(2025, 3, 9 + i).setLocale(language).toFormat('ccc'));
    expect(wrapper.findAll('.day-name').map(node => node.text())).toEqual(expected);
  });

  it('resolves event titles in the active language', async () => {
    await initI18n('es');
    const instance = makeInstance('a', at(12), { en: 'Concert', es: 'Concierto' });
    const wrapper = await mountGrid(WeekView, {
      anchorDate: ANCHOR, eventsByDay: { '2025-03-12': [instance] }, isLoading: false, ...routeBuilders(),
    });

    expect(wrapper.find('.event-name').text()).toBe('Concierto');
  });

  it('shows the empty state when the week has no events and nothing is loading', async () => {
    const wrapper = await mountGrid(WeekView, {
      anchorDate: ANCHOR, eventsByDay: {}, isLoading: false, ...routeBuilders(),
    });

    expect(wrapper.find('.ui-empty-state').text()).toBe('No events this week');
  });

  it('ignores events outside the displayed week when deciding it is empty', async () => {
    const wrapper = await mountGrid(WeekView, {
      anchorDate: ANCHOR,
      eventsByDay: { '2025-03-20': [makeInstance('a', at(20))] },
      isLoading: false,
      ...routeBuilders(),
    });

    expect(wrapper.find('.ui-empty-state').exists()).toBe(true);
  });

  it('shows loading rather than the empty state while loading', async () => {
    const wrapper = await mountGrid(WeekView, {
      anchorDate: ANCHOR, eventsByDay: {}, isLoading: true, ...routeBuilders(),
    });

    expect(wrapper.find('.ui-empty-state').exists()).toBe(false);
    expect(wrapper.find('[role="status"]').text()).toBe('Loading...');
  });

  it('shows neither when the week has events', async () => {
    const wrapper = await mountGrid(WeekView, {
      anchorDate: ANCHOR,
      eventsByDay: { '2025-03-12': [makeInstance('a', at(12))] },
      isLoading: false,
      ...routeBuilders(),
    });

    expect(wrapper.find('.ui-empty-state').exists()).toBe(false);
    // The live region stays mounted so later loading is announced; it is just empty.
    expect(wrapper.find('[role="status"]').text()).toBe('');
  });
});
