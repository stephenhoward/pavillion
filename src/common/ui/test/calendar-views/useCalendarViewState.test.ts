/**
 * Unit tests for useCalendarViewState.
 *
 * vue-router is stubbed with a reactive route and a `replace` spy that writes
 * the new query back onto that route, so a transition is observed the way a
 * container observes it: through the composable's own refs after the URL
 * changes, not through the call alone. The clock is frozen on a Wednesday so
 * "today" and the week around it are fixed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { reactive, ref } from 'vue';
import { DateTime } from 'luxon';

import type { CalendarViewMode } from '@/common/model/calendar_view';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the composable is imported
// ---------------------------------------------------------------------------

const route = reactive<{ query: Record<string, unknown> }>({ query: {} });
const replace = vi.fn((location: { query: Record<string, unknown> }) => {
  route.query = location.query;
});

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ replace }),
}));

import { useCalendarViewState } from '@/common/ui/calendar-views/useCalendarViewState';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wednesday 16 September 2026, midday local time. */
const TODAY = '2026-09-16';

function setup(query: Record<string, unknown>, defaultView: CalendarViewMode = 'list') {
  route.query = query;
  return useCalendarViewState({ defaultView: ref(defaultView) });
}

/** The query most recently written through router.replace. */
function lastQuery(): Record<string, unknown> {
  return replace.mock.calls[replace.mock.calls.length - 1][0].query;
}

function windowDates(window: { startDate: DateTime; endDate: DateTime } | null) {
  return window === null
    ? null
    : { start: window.startDate.toISODate(), end: window.endDate.toISODate() };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 16, 12, 0, 0));
  replace.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Reading the URL
// ---------------------------------------------------------------------------

describe('reading the route query', () => {
  it('reads a list view with no window', () => {
    const state = setup({ view: 'list' }, 'month');

    expect(state.viewMode.value).toBe('list');
    expect(state.effectiveViewMode.value).toBe('list');
    expect(state.window.value).toBeNull();
  });

  it('reads a week view and windows it Sunday to Saturday', () => {
    const state = setup({ view: 'week', date: '2026-03-11' });

    expect(state.viewMode.value).toBe('week');
    expect(state.anchorDate.value.toISODate()).toBe('2026-03-11');
    expect(windowDates(state.window.value)).toEqual({ start: '2026-03-08', end: '2026-03-14' });
  });

  it('reads a month view and windows the calendar month, not the padded grid', () => {
    const state = setup({ view: 'month', date: '2026-02-17' });

    expect(state.viewMode.value).toBe('month');
    expect(windowDates(state.window.value)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });

  it('uses the default view and today when the query names neither', () => {
    const state = setup({}, 'month');

    expect(state.viewMode.value).toBe('month');
    expect(state.anchorDate.value.toISODate()).toBe(TODAY);
    expect(windowDates(state.window.value)).toEqual({ start: '2026-09-01', end: '2026-09-30' });
  });

  it('keeps the anchor at the local start of day', () => {
    const state = setup({ view: 'week', date: '2026-03-11' });

    expect(state.anchorDate.value.equals(DateTime.local(2026, 3, 11))).toBe(true);
  });

  it('follows a route-query change made elsewhere', () => {
    const state = setup({ view: 'week', date: '2026-03-11' });

    route.query = { view: 'month', date: '2026-05-20' };

    expect(state.viewMode.value).toBe('month');
    expect(windowDates(state.window.value)).toEqual({ start: '2026-05-01', end: '2026-05-31' });
  });

  it('falls back to the default view for a garbage view, without writing the URL', () => {
    const state = setup({ view: 'agenda', date: '2026-03-11' }, 'week');

    expect(state.viewMode.value).toBe('week');
    expect(replace).not.toHaveBeenCalled();
  });

  it('falls back to today for a garbage date, without writing the URL', () => {
    const state = setup({ view: 'month', date: 'not-a-date' });

    expect(state.anchorDate.value.toISODate()).toBe(TODAY);
    expect(windowDates(state.window.value)).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(replace).not.toHaveBeenCalled();
  });

  it('falls back to today for a parseable but implausibly distant date', () => {
    const past = setup({ view: 'month', date: '0001-01-01' });
    expect(past.anchorDate.value.toISODate()).toBe(TODAY);

    const future = setup({ view: 'month', date: '9999-12-31' });
    expect(future.anchorDate.value.toISODate()).toBe(TODAY);

    expect(replace).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Writing the URL
// ---------------------------------------------------------------------------

describe('setView', () => {
  it('list -> week anchors on today when the list has no startDate', () => {
    const state = setup({});

    state.setView('week');

    expect(lastQuery()).toEqual({ view: 'week', date: TODAY });
    expect(windowDates(state.window.value)).toEqual({ start: '2026-09-13', end: '2026-09-19' });
  });

  it('list -> month anchors on the list filter startDate when present', () => {
    const state = setup({ startDate: '2026-11-04', endDate: '2026-11-30' });

    state.setView('month');

    expect(lastQuery()).toEqual({
      startDate: '2026-11-04',
      endDate: '2026-11-30',
      view: 'month',
      date: '2026-11-04',
    });
    expect(windowDates(state.window.value)).toEqual({ start: '2026-11-01', end: '2026-11-30' });
  });

  it('list -> week anchors on startDate too', () => {
    const state = setup({ startDate: '2026-11-04' });

    state.setView('week');

    expect(lastQuery().date).toBe('2026-11-04');
    expect(windowDates(state.window.value)).toEqual({ start: '2026-11-01', end: '2026-11-07' });
  });

  it('week -> month keeps the anchor', () => {
    const state = setup({ view: 'week', date: '2026-03-11', startDate: '2026-11-04' });

    state.setView('month');

    expect(lastQuery()).toEqual({ view: 'month', date: '2026-03-11', startDate: '2026-11-04' });
    expect(windowDates(state.window.value)).toEqual({ start: '2026-03-01', end: '2026-03-31' });
  });

  it('month -> list drops the date and leaves the list filters alone', () => {
    const state = setup({
      view: 'month',
      date: '2026-03-11',
      startDate: '2026-11-04',
      endDate: '2026-11-30',
    });

    state.setView('list');

    expect(lastQuery()).toEqual({ startDate: '2026-11-04', endDate: '2026-11-30' });
    expect('date' in lastQuery()).toBe(false);
    expect(state.window.value).toBeNull();
  });

  it('keeps an existing date over startDate when a tier-hidden week becomes a month', () => {
    const state = setup({ view: 'week', date: '2026-03-11', startDate: '2026-11-04' });
    state.setTier('medium');
    expect(state.effectiveViewMode.value).toBe('list');

    state.setView('month');

    expect(lastQuery().date).toBe('2026-03-11');
    expect(windowDates(state.window.value)).toEqual({ start: '2026-03-01', end: '2026-03-31' });
  });

  it('omits view when it equals the default', () => {
    const state = setup({ view: 'week', date: '2026-03-11' }, 'month');

    state.setView('month');

    expect(lastQuery()).toEqual({ date: '2026-03-11' });
    expect(state.viewMode.value).toBe('month');
  });

  it('emits view=list when the default is month', () => {
    const state = setup({}, 'month');

    state.setView('list');

    expect(lastQuery()).toEqual({ view: 'list' });
    expect(state.viewMode.value).toBe('list');
  });

  it('preserves search and categories on the merge', () => {
    const state = setup({ search: 'jazz', categories: ['a', 'b'] });

    state.setView('month');

    expect(lastQuery()).toEqual({
      search: 'jazz',
      categories: ['a', 'b'],
      view: 'month',
      date: TODAY,
    });
  });

  it('writes with replace, not push', () => {
    const state = setup({});

    state.setView('week');

    expect(replace).toHaveBeenCalledTimes(1);
  });
});

describe('goPrev / goNext / goToday', () => {
  it('steps a week view one week at a time', () => {
    const state = setup({ view: 'week', date: '2026-03-11' });

    state.goNext();
    expect(lastQuery().date).toBe('2026-03-18');
    expect(windowDates(state.window.value)).toEqual({ start: '2026-03-15', end: '2026-03-21' });

    state.goPrev();
    state.goPrev();
    expect(lastQuery().date).toBe('2026-03-04');
    expect(windowDates(state.window.value)).toEqual({ start: '2026-03-01', end: '2026-03-07' });
  });

  it('steps a month view one month at a time', () => {
    const state = setup({ view: 'month', date: '2026-03-11' });

    state.goNext();
    expect(lastQuery().date).toBe('2026-04-11');
    expect(windowDates(state.window.value)).toEqual({ start: '2026-04-01', end: '2026-04-30' });

    state.goPrev();
    state.goPrev();
    expect(lastQuery().date).toBe('2026-02-11');
    expect(windowDates(state.window.value)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });

  it('returns a week view to today', () => {
    const state = setup({ view: 'week', date: '2026-03-11' });

    state.goToday();

    expect(lastQuery()).toEqual({ view: 'week', date: TODAY });
    expect(windowDates(state.window.value)).toEqual({ start: '2026-09-13', end: '2026-09-19' });
  });

  it('returns a month view to today', () => {
    const state = setup({ view: 'month', date: '2026-03-11' });

    state.goToday();

    expect(lastQuery()).toEqual({ view: 'month', date: TODAY });
    expect(windowDates(state.window.value)).toEqual({ start: '2026-09-01', end: '2026-09-30' });
  });

  it('preserves the other query keys when navigating', () => {
    const state = setup({ view: 'week', date: '2026-03-11', search: 'jazz', categories: ['a'] });

    state.goNext();

    expect(lastQuery()).toEqual({ view: 'week', date: '2026-03-18', search: 'jazz', categories: ['a'] });
  });

  it('does nothing in a list view', () => {
    const state = setup({});

    state.goNext();
    state.goPrev();

    expect(replace).not.toHaveBeenCalled();
  });

  it('does not step past the plausibility bound', () => {
    const state = setup({ view: 'month', date: '2126-09-01' });
    expect(state.anchorDate.value.toISODate()).toBe('2126-09-01');

    state.goNext();

    expect(replace).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Width tiers
// ---------------------------------------------------------------------------

describe('tiers', () => {
  it('offers list, week and month at the wide tier', () => {
    const state = setup({ view: 'week', date: '2026-03-11' });

    state.setTier('wide');

    expect(state.availableViews.value).toEqual(['list', 'week', 'month']);
    expect(state.effectiveViewMode.value).toBe('week');
    expect(windowDates(state.window.value)).toEqual({ start: '2026-03-08', end: '2026-03-14' });
  });

  it('drops week at the medium tier and shows the list in its place', () => {
    const state = setup({ view: 'week', date: '2026-03-11' });

    state.setTier('medium');

    expect(state.availableViews.value).toEqual(['list', 'month']);
    expect(state.viewMode.value).toBe('week');
    expect(state.effectiveViewMode.value).toBe('list');
    expect(state.window.value).toBeNull();
  });

  it('keeps month at the medium tier', () => {
    const state = setup({ view: 'month', date: '2026-03-11' });

    state.setTier('medium');

    expect(state.effectiveViewMode.value).toBe('month');
    expect(windowDates(state.window.value)).toEqual({ start: '2026-03-01', end: '2026-03-31' });
  });

  it('offers only the list at the narrow tier', () => {
    const state = setup({ view: 'month', date: '2026-03-11' });

    state.setTier('narrow');

    expect(state.availableViews.value).toEqual(['list']);
    expect(state.effectiveViewMode.value).toBe('list');
    expect(state.window.value).toBeNull();
  });

  it('restores the URL view when the tier widens again', () => {
    const state = setup({ view: 'week', date: '2026-03-11' });

    state.setTier('narrow');
    state.setTier('wide');

    expect(state.effectiveViewMode.value).toBe('week');
    expect(windowDates(state.window.value)).toEqual({ start: '2026-03-08', end: '2026-03-14' });
  });

  it('never writes the URL on a tier change', () => {
    const state = setup({ view: 'month', date: '2026-03-11' });

    state.setTier('narrow');
    state.setTier('medium');
    state.setTier('wide');

    expect(replace).not.toHaveBeenCalled();
  });
});
