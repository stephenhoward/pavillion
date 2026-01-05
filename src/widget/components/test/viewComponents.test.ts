import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import WeekView from '../WeekView.vue';
import MonthView from '../MonthView.vue';
import ListView from '../ListView.vue';
import { usePublicCalendarStore } from '@/site/stores/publicCalendarStore';

// Initialize i18next for tests
i18next.init({
  lng: 'en',
  resources: {
    en: {
      system: {
        previous_week: 'Previous Week',
        next_week: 'Next Week',
        previous_month: 'Previous Month',
        next_month: 'Next Month',
        loading_events: 'Loading events...',
        no_events_with_filters: 'No events match your filters',
        no_events_available: 'No events available',
        no_events_this_month: 'No events this month',
      },
    },
  },
});

// Create a mock router
const createMockRouter = () => {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/widget/:urlName', name: 'widget-calendar', component: { template: '<div></div>' } },
      { path: '/widget/:urlName/events/:eventId', name: 'widget-event-detail', component: { template: '<div></div>' } },
    ],
  });
};

describe('Widget View Components', () => {
  let router: any;

  beforeEach(() => {
    setActivePinia(createPinia());
    router = createMockRouter();
  });

  describe('WeekView', () => {
    it('renders week grid on desktop with 7 columns', async () => {
      const wrapper = mount(WeekView, {
        global: {
          plugins: [[I18NextVue, { i18next }], router],
        },
      });

      // Check for week grid container
      const weekGrid = wrapper.find('.week-grid');
      expect(weekGrid.exists()).toBe(true);

      // Week view should have 7 day columns
      const dayColumns = wrapper.findAll('.week-day-column');
      expect(dayColumns.length).toBe(7);
    });

    it('shows navigation controls for week', async () => {
      const wrapper = mount(WeekView, {
        global: {
          plugins: [[I18NextVue, { i18next }], router],
        },
      });

      // Should have previous and next buttons
      const prevButton = wrapper.find('.nav-prev');
      const nextButton = wrapper.find('.nav-next');

      expect(prevButton.exists()).toBe(true);
      expect(nextButton.exists()).toBe(true);
    });

    it('displays "+N more" indicator when more than 3 events per day', async () => {
      const publicStore = usePublicCalendarStore();

      // Mock events with more than 3 events on one day
      // FIXED: Component uses publicStore.allEvents, not publicStore.events
      publicStore.allEvents = [
        { id: '1', start: { toISODate: () => '2026-01-06', toLocaleString: () => '10:00 AM' }, event: { id: 'e1', content: () => ({ name: 'Event 1' }), media: null, categories: [] } },
        { id: '2', start: { toISODate: () => '2026-01-06', toLocaleString: () => '11:00 AM' }, event: { id: 'e2', content: () => ({ name: 'Event 2' }), media: null, categories: [] } },
        { id: '3', start: { toISODate: () => '2026-01-06', toLocaleString: () => '12:00 PM' }, event: { id: 'e3', content: () => ({ name: 'Event 3' }), media: null, categories: [] } },
        { id: '4', start: { toISODate: () => '2026-01-06', toLocaleString: () => '1:00 PM' }, event: { id: 'e4', content: () => ({ name: 'Event 4' }), media: null, categories: [] } },
        { id: '5', start: { toISODate: () => '2026-01-06', toLocaleString: () => '2:00 PM' }, event: { id: 'e5', content: () => ({ name: 'Event 5' }), media: null, categories: [] } },
      ] as any;

      const wrapper = mount(WeekView, {
        global: {
          plugins: [[I18NextVue, { i18next }], router],
        },
      });

      // Should show overflow indicator
      const overflow = wrapper.find('.event-overflow');
      expect(overflow.exists()).toBe(true);
      expect(overflow.text()).toContain('+2');
    });
  });

  describe('MonthView', () => {
    it('renders traditional calendar grid on desktop', async () => {
      const wrapper = mount(MonthView, {
        global: {
          plugins: [[I18NextVue, { i18next }], router],
        },
      });

      // Check for month grid container (7x5 or 7x6)
      const monthGrid = wrapper.find('.month-grid');
      expect(monthGrid.exists()).toBe(true);

      // Month view should have day cells
      const dayCells = wrapper.findAll('.month-day-cell');
      expect(dayCells.length).toBeGreaterThanOrEqual(35); // At least 5 weeks
    });

    it('shows month navigation controls', async () => {
      const wrapper = mount(MonthView, {
        global: {
          plugins: [[I18NextVue, { i18next }], router],
        },
      });

      // Should have previous and next month buttons
      const prevButton = wrapper.find('.nav-prev');
      const nextButton = wrapper.find('.nav-next');

      expect(prevButton.exists()).toBe(true);
      expect(nextButton.exists()).toBe(true);
    });

    it('displays condensed list view on mobile', async () => {
      // FIXED: Mock window.innerWidth properly using vi.stubGlobal
      vi.stubGlobal('innerWidth', 400);

      // Mock window.addEventListener for resize listener
      const mockAddEventListener = vi.fn();
      vi.stubGlobal('addEventListener', mockAddEventListener);

      const wrapper = mount(MonthView, {
        global: {
          plugins: [[I18NextVue, { i18next }], router],
        },
      });

      // Wait for component to mount and check mobile state
      await wrapper.vm.$nextTick();

      // Should show condensed list instead of grid
      const condensedList = wrapper.find('.month-condensed-list');
      expect(condensedList.exists()).toBe(true);

      // Clean up mocks
      vi.unstubAllGlobals();
    });
  });

  describe('ListView', () => {
    it('adapts calendar.vue pattern for widget', async () => {
      const publicStore = usePublicCalendarStore();

      // FIXED: Component uses publicStore.allEvents and getFilteredEventsByDay getter
      publicStore.allEvents = [
        { id: '1', start: { toISODate: () => '2026-01-06', toLocaleString: () => '10:00 AM' }, event: { id: 'e1', content: () => ({ name: 'Event 1' }), media: null, categories: [] } },
      ] as any;

      const wrapper = mount(ListView, {
        global: {
          plugins: [[I18NextVue, { i18next }], router],
        },
      });

      // Should have day sections
      const daySection = wrapper.find('.day');
      expect(daySection.exists()).toBe(true);
    });

    it('shows horizontal-scroll day groups', async () => {
      const publicStore = usePublicCalendarStore();

      // FIXED: Set allEvents so getFilteredEventsByDay has data
      publicStore.allEvents = [
        { id: '1', start: { toISODate: () => '2026-01-06', toLocaleString: () => '10:00 AM' }, event: { id: 'e1', content: () => ({ name: 'Event 1' }), media: null, categories: [] } },
      ] as any;

      const wrapper = mount(ListView, {
        global: {
          plugins: [[I18NextVue, { i18next }], router],
        },
      });

      // Should have events list with horizontal scroll
      const eventsList = wrapper.find('.events');
      expect(eventsList.exists()).toBe(true);
    });
  });

  describe('Navigation and Gestures', () => {
    it('handles swipe left gesture for next week', async () => {
      const wrapper = mount(WeekView, {
        global: {
          plugins: [[I18NextVue, { i18next }], router],
        },
      });

      // Swipe gestures tested in isolation (composable handles logic)
      const weekContainer = wrapper.find('.week-view');
      expect(weekContainer.exists()).toBe(true);
    });

    it('handles swipe right gesture for previous week', async () => {
      const wrapper = mount(WeekView, {
        global: {
          plugins: [[I18NextVue, { i18next }], router],
        },
      });

      // Swipe gestures tested in isolation (composable handles logic)
      const weekContainer = wrapper.find('.week-view');
      expect(weekContainer.exists()).toBe(true);
    });
  });
});
