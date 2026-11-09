import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { nextTick } from 'vue';
import { setActivePinia, createPinia, Pinia } from 'pinia';
import i18next from 'i18next';

import { mountComponent } from '@/client/test/lib/vue';
import EventsTab from '@/client/components/logged_in/calendar-content/events-tab.vue';
import { Calendar } from '@/common/model/calendar';

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};

vi.mock('@/client/composables/useToast', () => ({
  useToast: () => mockToast,
}));

vi.mock('@/client/service/calendar', () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      loadCalendars: vi.fn().mockResolvedValue([]),
      replaceEventCategories: vi.fn(),
    };
  }),
}));

vi.mock('@/client/service/event', () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      deleteEvent: vi.fn(),
      unshareReposted: vi.fn(),
    };
  }),
}));

vi.mock('@/client/stores/categoryStore', () => ({
  useCategoryStore: () => ({
    categories: {},
  }),
}));

vi.mock('@/client/stores/calendarStore', () => ({
  useCalendarStore: () => ({
    selectedCalendar: null,
    setSelectedCalendar: vi.fn(),
    calendars: [],
  }),
}));

const routes: RouteRecordRaw[] = [
  {
    path: '/calendar/:calendar/events',
    component: {},
    name: 'calendar-events',
  },
  {
    path: '/event/new',
    component: {},
    name: 'event_new',
  },
  {
    path: '/event/:eventId',
    component: {},
    name: 'event_edit',
  },
];

const createCalendar = () => {
  const calendar = new Calendar('calendar-123', 'test-calendar');
  calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' } as any);
  return calendar;
};

describe('EventsTab - bulk category assignment toast', () => {
  let activePinia: Pinia;

  beforeEach(() => {
    activePinia = createPinia();
    setActivePinia(activePinia);
    mockToast.success.mockClear();
  });

  it('reports the assignment, not a deletion, when categories are assigned', async () => {
    const router: Router = createRouter({ history: createMemoryHistory(), routes });
    router.push({ name: 'calendar-events', params: { calendar: 'test-calendar' } });
    await router.isReady();

    const wrapper = mountComponent(EventsTab, router, {
      pinia: activePinia,
      props: { calendar: createCalendar(), isLoading: false },
      stubs: {
        SearchFilter: true,
        BulkOperationsMenu: true,
        CategorySelectionDialog: true,
        ReportEvent: true,
        RepostCategoriesModal: true,
        ModalLayout: true,
        EventImage: true,
      },
    });
    await nextTick();

    wrapper.findComponent({ name: 'CategorySelectionDialog' })
      .vm.$emit('assign-complete', { eventCount: 2, categoryCount: 1 });
    await nextTick();

    expect(mockToast.success).toHaveBeenCalledTimes(1);
    const message = mockToast.success.mock.calls[0][0];
    expect(message).toBe(i18next.t('calendars:bulk_operations.assign_success', { count: 2 }));
    expect(message).not.toMatch(/deleted/i);
  });
});
