/**
 * Tests for the calendar.vue empty state of an unfiltered list whose default
 * date window holds no events: it names the window searched and, when a later
 * event exists, links to its day.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import { createMemoryHistory, createRouter, RouterLink, type RouteRecordRaw } from 'vue-router';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';

const mockCurrentLocale = ref('en');

vi.mock('@/common/ui/composables/useLocale', () => ({
  useLocale: () => ({
    currentLocale: mockCurrentLocale,
    switchLocale: vi.fn(),
    localizedPath: (path: string) => path,
  }),
}));

vi.mock('@/site/service/calendar', () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      getCalendarByUrlName: vi.fn().mockResolvedValue({
        urlName: 'test_calendar',
        content: () => ({ name: 'Test Calendar', description: '' }),
        hasContent: () => true,
        getLanguages: () => ['en'],
      }),
    };
  }),
}));

function createMockStore(): Record<string, any> {
  return {
    currentCalendarUrlName: 'test_calendar',
    isCalendarSettingsLoaded: true,
    calendarDefaultDateRange: '2weeks',
    allEvents: [],
    availableCategories: [],
    getFilteredEventsByDay: {},
    hasActiveFilters: false,
    hasNonDateFilters: false,
    hasOnlyDateFilters: false,
    isLoadingEvents: false,
    hasLoadedEvents: true,
    isSearchPending: false,
    eventError: null,
    categoryError: null,
    searchQuery: '',
    nextEventDate: null,
    setServerDefaultDateRange: vi.fn(),
    setCurrentCalendar: vi.fn(),
    loadCalendar: vi.fn().mockResolvedValue(undefined),
    loadNextEventDate: vi.fn().mockResolvedValue(undefined),
    clearAllFilters: vi.fn(),
    reloadWithFilters: vi.fn(),
    setViewWindow: vi.fn(),
  };
}

let mockStore = createMockStore();

vi.mock('@/site/stores/publicCalendarStore', () => ({
  usePublicCalendarStore: () => mockStore,
}));

vi.mock('@/site/components/not-found.vue', () => ({ default: { template: '<div></div>' } }));
vi.mock('@/site/components/search-filter-public.vue', () => ({ default: { template: '<div></div>' } }));

import enSystem from '@/site/locales/en/system.json';
import Calendar from '@/site/components/calendar.vue';
import { getDefaultDateRange } from '@/common/utils/datePresets';

const routes: RouteRecordRaw[] = [{ path: '/:calendar', component: Calendar, name: 'calendar' }];

async function mountCalendar() {
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push('/test_calendar');
  await router.isReady();
  const wrapper = mount(Calendar, {
    global: { plugins: [router, [I18NextVue, { i18next }]] },
  });
  await flushPromises();
  return wrapper;
}

describe('calendar.vue empty state with an empty default window', () => {
  beforeAll(async () => {
    await i18next.init({ lng: 'en', resources: { en: { system: enSystem } }, defaultNS: 'system' });
  });

  beforeEach(() => {
    mockCurrentLocale.value = 'en';
    mockStore = createMockStore();
  });

  it('names the end of the window it searched instead of claiming nothing is upcoming', async () => {
    const wrapper = await mountCalendar();

    const hint = wrapper.find('.empty-state-hint').text();
    expect(hint).toMatch(/^No events are scheduled between today and /);
    expect(hint).not.toMatch(/upcoming/i);
    const endYear = getDefaultDateRange('2weeks').endDate.slice(0, 4);
    expect(hint).toContain(endYear);
    wrapper.unmount();
  });

  it('looks up the next event once for the unfiltered empty list', async () => {
    const wrapper = await mountCalendar();

    expect(mockStore.loadNextEventDate).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('offers a link that sets the list filter to the next event date', async () => {
    mockStore.nextEventDate = '2026-12-25';

    const wrapper = await mountCalendar();

    const link = wrapper.findComponent(RouterLink);
    expect(link.exists()).toBe(true);
    expect(link.text()).toContain('2026');
    const target = link.props('to') as { query: Record<string, string> };
    expect(target.query.startDate).toBe('2026-12-25');
    expect(target.query.endDate).toBe('2026-12-25');
    wrapper.unmount();
  });

  it('renders no link when no later event was found', async () => {
    const wrapper = await mountCalendar();

    expect(wrapper.findComponent(RouterLink).exists()).toBe(false);
    wrapper.unmount();
  });

  it('does not look anything up while a filter is active', async () => {
    mockStore.hasActiveFilters = true;
    mockStore.hasOnlyDateFilters = true;

    const wrapper = await mountCalendar();

    expect(mockStore.loadNextEventDate).not.toHaveBeenCalled();
    expect(wrapper.find('.empty-state-hint').text()).toContain('No events are scheduled in this date range.');
    wrapper.unmount();
  });
});
