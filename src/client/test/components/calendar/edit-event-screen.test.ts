import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createRouter, createWebHistory, Router } from 'vue-router';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import { nextTick } from 'vue';
import EditEventView from '@/client/components/logged_in/calendar/edit_event.vue';
import { CalendarEvent } from '@/common/model/events';
import { Calendar } from '@/common/model/calendar';
import { EventLocation } from '@/common/model/location';
import { mountComponent } from '@/client/test/lib/vue';

// Create a mock calendar for testing
const createMockCalendar = (id: string, urlName: string) => {
  const calendar = new Calendar(id, urlName);
  calendar.addContent({
    language: 'en',
    name: `Test Calendar ${urlName}`,
    description: 'Test Description',
  });
  return calendar;
};

// Create a mock event for testing
const createMockEvent = (id?: string) => {
  const event = new CalendarEvent();
  if (id) {
    event.id = id;
  }
  event.calendarId = 'calendar-123';
  event.location = new EventLocation();
  event.addSchedule();
  event.addContent({
    language: 'en',
    name: 'Test Event',
    description: 'Test Description',
  });
  return event;
};

// Mock the CalendarService
vi.mock('@/client/service/calendar', () => ({
  default: vi.fn().mockImplementation(() => ({
    loadCalendars: vi.fn().mockResolvedValue([
      createMockCalendar('calendar-123', 'test-calendar'),
    ]),
    getCalendarByUrlName: vi.fn(),
  })),
}));

// Mock the EventService
vi.mock('@/client/service/event', () => ({
  default: vi.fn().mockImplementation(() => ({
    initEvent: vi.fn((calendar) => {
      const event = new CalendarEvent();
      event.calendarId = calendar.id;
      event.location = new EventLocation();
      event.addSchedule();
      return event;
    }),
    saveEvent: vi.fn().mockResolvedValue(createMockEvent('new-event-id')),
  })),
}));

// Mock the CategoryService
vi.mock('@/client/service/category', () => ({
  default: vi.fn().mockImplementation(() => ({
    getEventCategories: vi.fn().mockResolvedValue([]),
    assignCategoriesToEvent: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock i18next-vue
vi.mock('i18next-vue', () => ({
  default: {
    install: () => {},
  },
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

// Mock i18next
vi.mock('i18next', () => ({
  default: {},
}));

// Mock locale service (used by shared mountComponent helper)
vi.mock('@/client/service/locale', () => ({
  initI18Next: () => {},
}));

// Mock iso-639-1-dir
vi.mock('iso-639-1-dir', () => ({
  default: {
    getName: (code: string) => code === 'en' ? 'English' : code,
    getDir: () => 'ltr',
    getAllCodes: () => ['en', 'es', 'fr'],
  },
}));

// Mock useEventDuplication composable
vi.mock('@/client/composables/useEventDuplication', () => ({
  useEventDuplication: () => ({
    stripEventForDuplication: vi.fn((event) => {
      const cloned = event.clone();
      cloned.id = '';
      return cloned;
    }),
  }),
}));

// Mock useCalendarStore
vi.mock('@/client/stores/calendarStore', () => ({
  useCalendarStore: () => ({
    
    getLastInteractedCalendar: null,
    setLastInteractedCalendar: vi.fn(),
    calendars: [],
    addCalendar: vi.fn(),
  }),
}));

describe('EditEventView - Component Refactoring', () => {
  let router: Router;
  let pinia: Pinia;

  const createTestRouter = () => {
    return createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/event', name: 'event_new', component: EditEventView },
        { path: '/event/:eventId', name: 'event_edit', component: EditEventView, props: true },
        { path: '/calendar', name: 'calendars', component: { template: '<div>Calendars</div>' } },
        { path: '/calendar/:calendar', name: 'calendar', component: { template: '<div>Calendar</div>' } },
        { path: '/auth/login', name: 'login', component: { template: '<div>Login</div>' } },
      ],
    });
  };

  const mountEditEventView = async (routePath: string, props = {}) => {
    router = createTestRouter();
    await router.push(routePath);
    await router.isReady();

    const wrapper = mountComponent(EditEventView, router, {
      pinia,
      props,
      stubs: {
        EventRecurrenceView: true,
        languagePicker: true,
        ImageUpload: true,
        CategorySelector: true,
      },
    });

    // Wait for async initialization
    await flushPromises();
    await nextTick();
    await nextTick();

    return wrapper;
  };

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Mode Detection - Create Mode', () => {
    it('should detect create mode when no route params are present', async () => {
      const wrapper = await mountEditEventView('/event');

      // In create mode, the page title should indicate new event creation
      const header = wrapper.find('.page-header h1');
      expect(header.exists()).toBe(true);
      // The title should contain the create event translation key
      expect(header.text()).toContain('create_event_title');
    });

    it('should initialize a new event in create mode', async () => {
      const wrapper = await mountEditEventView('/event');

      // The form should be visible for creating a new event
      const form = wrapper.find('form');
      expect(form.exists()).toBe(true);

      // Should have the event-editor-page container
      const pageContainer = wrapper.find('.event-editor-page');
      expect(pageContainer.exists()).toBe(true);
    });
  });

  describe('Mode Detection - Edit Mode', () => {
    it('should detect edit mode when eventId param is present', async () => {
      const testEventId = '123e4567-e89b-12d3-a456-426614174000';

      // Mock the fetch for loading event in edit mode
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: testEventId,
          calendarId: 'calendar-123',
          schedules: [],
          contents: [{ language: 'en', name: 'Test Event', description: 'Test' }],
          location: {},
          categories: [],
        }),
      });

      await mountEditEventView(`/event/${testEventId}`, { eventId: testEventId });

      // In edit mode, the eventId should be accessible from route params
      expect(router.currentRoute.value.params.eventId).toBe(testEventId);
    });
  });

  describe('Mode Detection - Duplicate Mode', () => {
    it('should detect duplicate mode when from query param is present', async () => {
      const sourceEventId = '123e4567-e89b-12d3-a456-426614174000';

      // Mock the fetch for loading source event
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: sourceEventId,
          calendarId: 'calendar-123',
          schedules: [],
          contents: [{ language: 'en', name: 'Test Event', description: 'Test' }],
          location: {},
          categories: [],
        }),
      });

      const wrapper = await mountEditEventView(`/event?from=${sourceEventId}`);

      // In duplicate mode, the from query param should be accessible
      expect(router.currentRoute.value.query.from).toBe(sourceEventId);

      // The title should indicate duplication
      const header = wrapper.find('.page-header h1');
      expect(header.text()).toContain('duplicate_event_title');
    });
  });

  describe('Navigation Header', () => {
    it('should display navigation header with back button', async () => {
      const wrapper = await mountEditEventView('/event');

      // Should have a page header
      const header = wrapper.find('.page-header');
      expect(header.exists()).toBe(true);

      // Should have a back button
      const backButton = wrapper.find('.back-button');
      expect(backButton.exists()).toBe(true);
    });

    it('should display dynamic page title based on mode', async () => {
      const wrapper = await mountEditEventView('/event');

      const title = wrapper.find('.page-header h1');
      expect(title.exists()).toBe(true);
      expect(title.text()).toBeTruthy();
    });
  });

  describe('Full Page Layout', () => {
    it('should not use ModalLayout wrapper (no dialog element)', async () => {
      const wrapper = await mountEditEventView('/event');

      // Should not have dialog element (modal wrapper)
      const dialog = wrapper.find('dialog');
      expect(dialog.exists()).toBe(false);

      // Should have full-page container
      const pageContainer = wrapper.find('.event-editor-page');
      expect(pageContainer.exists()).toBe(true);
    });

    it('should have proper full-page container styling', async () => {
      const wrapper = await mountEditEventView('/event');

      // Should have the main page container class
      const container = wrapper.find('.event-editor-page');
      expect(container.exists()).toBe(true);

      // Should have header and main content areas
      const header = wrapper.find('.page-header');
      const main = wrapper.find('main[role="main"]');

      expect(header.exists()).toBe(true);
      expect(main.exists()).toBe(true);
    });
  });
});
