/**
 * Unit tests for useCalendarViewContainer.
 *
 * vue-router is stubbed with a reactive route and a `replace` spy that writes
 * the new query back onto that route, as in useCalendarViewState.test.ts.
 * useContainerWidth is replaced with refs the test drives, so the measured
 * width is pinned without layout. The composable runs inside a tiny harness
 * component so its onMounted hook fires on mount, and the target is a stub
 * that logs every call into one list so call order is asserted, not only
 * presence. The clock is frozen on Wednesday 16 September 2026.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, reactive, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';

import type { CalendarViewMode } from '@/common/model/calendar_view';
import type CalendarEventInstance from '@/common/model/event_instance';
import type { WidthTier } from '@/common/ui/assets/breakpoints';

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

const measured = { tier: ref<WidthTier>('narrow'), width: ref(0) };

vi.mock('@/common/ui/composables/useContainerWidth', () => ({
  useContainerWidth: () => measured,
}));

import {
  useCalendarViewContainer,
  type CalendarViewContainer,
} from '@/common/ui/calendar-views/useCalendarViewContainer';
import type { CalendarWindowSyncTarget } from '@/common/ui/calendar-views/useCalendarWindowSync';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let calls: unknown[][];
let ready: boolean;
let wrapper: VueWrapper | null = null;

const target: CalendarWindowSyncTarget = {
  setViewWindow(start, end) {
    calls.push(['setViewWindow', start, end]);
  },
  async reloadWithFilters() {
    calls.push(['reloadWithFilters']);
  },
};

const calendarRoute = vi.fn((query: Record<string, string>) => ({ name: 'calendar', query }));

/**
 * Mount a harness that calls the composable during setup, with the route
 * query and measured width already in place.
 */
function setup(options: {
  query?: Record<string, unknown>;
  defaultView?: CalendarViewMode;
  tier?: WidthTier;
  width?: number;
  isLoading?: () => boolean;
} = {}): CalendarViewContainer {
  route.query = options.query ?? {};
  measured.tier.value = options.tier ?? 'narrow';
  measured.width.value = options.width ?? 0;

  let container: CalendarViewContainer | undefined;
  const Harness = defineComponent({
    setup() {
      container = useCalendarViewContainer({
        defaultView: computed(() => options.defaultView ?? 'list'),
        target,
        isReady: () => ready,
        isLoading: options.isLoading ?? (() => false),
        locale: ref('en'),
        eventRoute: (instance: CalendarEventInstance) => ({ name: 'event', params: { id: instance.id } }),
        calendarRoute,
      });
      return () => h('div');
    },
  });

  wrapper = mount(Harness);
  return container as CalendarViewContainer;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 16, 12, 0, 0));
  calls = [];
  ready = false;
  replace.mockClear();
  calendarRoute.mockClear();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Setup ordering
// ---------------------------------------------------------------------------

describe('setup', () => {
  it('clears the view window before syncing the view\'s own window', () => {
    setup({ query: { view: 'month', date: '2026-09-10' }, tier: 'wide', width: 1200 });

    expect(calls[0]).toEqual(['setViewWindow', null, null]);
    expect(calls[1]).toEqual(['setViewWindow', '2026-09-01', '2026-09-30']);
  });

  it('clears the view window on a list, with no other call', () => {
    setup();

    expect(calls).toEqual([['setViewWindow', null, null]]);
  });
});

// ---------------------------------------------------------------------------
// Width tier
// ---------------------------------------------------------------------------

describe('width tier', () => {
  it('keeps a deep-linked month while the root is unmeasured', () => {
    const container = setup({ query: { view: 'month', date: '2026-09-10' }, tier: 'narrow', width: 0 });

    expect(container.effectiveViewMode.value).toBe('month');
  });

  it('collapses to the list once a narrow width is measured', async () => {
    const container = setup({ query: { view: 'month', date: '2026-09-10' }, tier: 'narrow', width: 0 });

    measured.width.value = 320;
    await nextTick();

    expect(container.effectiveViewMode.value).toBe('list');
    expect(container.availableViews.value).toEqual(['list']);
  });

  it('collapses to the list when the root is already measured narrow at setup', () => {
    const container = setup({ query: { view: 'month', date: '2026-09-10' }, tier: 'narrow', width: 320 });

    expect(container.effectiveViewMode.value).toBe('list');
  });
});

// ---------------------------------------------------------------------------
// Reload gating
// ---------------------------------------------------------------------------

describe('reload gating', () => {
  it('does not reload during setup, even when ready', () => {
    ready = true;
    setup({ query: { view: 'month', date: '2026-09-10' }, tier: 'wide', width: 1200 });

    expect(calls.filter(call => call[0] === 'reloadWithFilters')).toEqual([]);
  });

  it('does not reload after mount while the app is not ready', async () => {
    const container = setup({ query: { view: 'month', date: '2026-09-10' }, tier: 'wide', width: 1200 });
    calls = [];

    container.goNext();
    await nextTick();

    expect(calls).toEqual([['setViewWindow', '2026-10-01', '2026-10-31']]);
  });

  it('reloads once after mount when ready and the window changes', async () => {
    const container = setup({ query: { view: 'month', date: '2026-09-10' }, tier: 'wide', width: 1200 });
    ready = true;
    calls = [];

    container.goNext();
    await nextTick();

    expect(calls).toEqual([
      ['setViewWindow', '2026-10-01', '2026-10-31'],
      ['reloadWithFilters'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Day links
// ---------------------------------------------------------------------------

describe('dayRoute', () => {
  it('emits view=list when the default is not the list', () => {
    const container = setup({
      query: { view: 'month', date: '2026-09-10', categories: 'a' },
      defaultView: 'week',
      tier: 'wide',
      width: 1200,
    });

    const result = container.dayRoute('2026-09-14');

    expect(calendarRoute).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      name: 'calendar',
      query: { view: 'list', categories: 'a', startDate: '2026-09-14', endDate: '2026-09-14' },
    });
  });

  it('omits the view key and drops the date key when the default is the list', () => {
    const container = setup({
      query: { view: 'month', date: '2026-09-10', search: 'jazz' },
      defaultView: 'list',
      tier: 'wide',
      width: 1200,
    });

    const result = container.dayRoute('2026-09-14');

    expect(result).toEqual({
      name: 'calendar',
      query: { search: 'jazz', startDate: '2026-09-14', endDate: '2026-09-14' },
    });
  });
});

// ---------------------------------------------------------------------------
// Toolbar and grid bindings
// ---------------------------------------------------------------------------

describe('bindings', () => {
  it('has an empty period label on the list', () => {
    const container = setup();

    expect(container.currentPeriodLabel.value).toBe('');
  });

  it('labels the month being shown', () => {
    const container = setup({ query: { view: 'month', date: '2026-09-10' }, tier: 'wide', width: 1200 });

    expect(container.currentPeriodLabel.value).toBe('September 2026');
  });

  it('reports the grid loading through the caller\'s predicate', () => {
    const loading = ref(true);
    const container = setup({ isLoading: () => loading.value });

    expect(container.gridIsLoading.value).toBe(true);
    loading.value = false;
    expect(container.gridIsLoading.value).toBe(false);
  });

  it('passes the caller\'s event route through', () => {
    const container = setup();
    const instance = { id: 'occurrence-1' } as unknown as CalendarEventInstance;

    expect(container.eventRoute(instance)).toEqual({ name: 'event', params: { id: 'occurrence-1' } });
  });
});
