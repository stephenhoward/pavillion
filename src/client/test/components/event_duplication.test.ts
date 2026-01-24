import { expect, describe, it, afterEach, beforeEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import sinon from 'sinon';
import { nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import axios from 'axios';

import { CalendarEvent, CalendarEventContent } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';
import { Media } from '@/common/model/media';
import { EventCategory } from '@/common/model/event_category';
import { Calendar } from '@/common/model/calendar';
import { mountComponent } from '@/client/test/lib/vue';
import EditEvent from '@/client/components/logged_in/calendar/edit_event.vue';
import EventService from '@/client/service/event';
import CalendarService from '@/client/service/calendar';

// Mock useCalendarStore
vi.mock('@/client/stores/calendarStore', () => ({
  useCalendarStore: () => ({

    getLastInteractedCalendar: null,
    setLastInteractedCalendar: vi.fn(),
    calendars: [],
    addCalendar: vi.fn(),
  }),
}));

// Mock CategoryService
vi.mock('@/client/service/category', () => ({
  default: vi.fn().mockImplementation(() => ({
    getEventCategories: vi.fn().mockResolvedValue([]),
    assignCategoriesToEvent: vi.fn().mockResolvedValue(undefined),
  })),
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

const routes: RouteRecordRaw[] = [
  { path: '/login', component: {}, name: 'login', props: true },
  { path: '/logout', component: {}, name: 'logout' },
  { path: '/calendar', component: {}, name: 'calendars' },
  { path: '/calendar/:calendar', component: {}, name: 'calendar' },
  { path: '/event', component: EditEvent, name: 'event_new' },
  { path: '/event/:eventId', component: EditEvent, name: 'event_edit', props: true },
];

// Test utility functions for event duplication
// Uses the actual EventService method to test real functionality

/**
 * Creates a test event with full data for duplication testing
 */
function createFullTestEvent(): CalendarEvent {
  const event = new CalendarEvent('event-id', 'calendar-id', 'https://example.com/event');
  event.date = '2025-09-15';

  // Add content in English
  const content = new CalendarEventContent('en', 'Test Event', 'Test Description');
  event.addContent(content);

  // Add location
  event.location = new EventLocation('location-id', 'Test Venue', '123 Test St', 'Test City');

  // Add media
  event.media = new Media('media-id', 'calendar-id', 'abc123hash', 'test-image.jpg', 'image/jpeg', 1024);
  event.mediaId = 'media-id';

  // Add schedule
  event.addSchedule();
  event.schedules[0].id = 'schedule-id';

  // Add categories
  const category = new EventCategory('category-id', 'calendar-id');
  const categoryContent = category.createContent('en');
  categoryContent.name = 'Test Category';
  category.addContent(categoryContent);
  event.categories.push(category);

  return event;
}

const mountedEditorOnRoute = async (routePath: string, calendars: Calendar[] = []) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  // Navigate to the specified route first
  await router.push(routePath);
  await router.isReady();

  // Stub loadCalendars
  sinon.stub(CalendarService.prototype, 'loadCalendars').resolves(calendars);

  const pinia = createPinia();
  setActivePinia(pinia);

  const wrapper = mountComponent(EditEvent, router, {
    pinia,
    provide: {
      site_config: {
        settings: () => ({}),
      },
    },
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

  return {
    wrapper,
    router,
  };
};

describe('Event Duplication System', () => {
  let currentWrapper: any = null;
  let pinia: Pinia;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    // Restore any sinon stubs before each test
    sinon.restore();
    sandbox = sinon.createSandbox();
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    sandbox.restore();
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
      await nextTick();
    }
  });

  describe('prepareEventForDuplication utility', () => {
    it('should clear all ID fields from event', () => {
      const originalEvent = createFullTestEvent();
      const duplicatedEvent = EventService.prepareEventForDuplication(originalEvent);

      // Verify main event IDs are cleared
      expect(duplicatedEvent.id).toBe('');
      expect(duplicatedEvent.eventSourceUrl).toBe('');
      expect(duplicatedEvent.mediaId).toBe(null);

      // Verify preserved fields
      expect(duplicatedEvent.calendarId).toBe('calendar-id');
      expect(duplicatedEvent.date).toBe('2025-09-15');
      expect(duplicatedEvent.content('en').name).toBe('Test Event');
      expect(duplicatedEvent.content('en').description).toBe('Test Description');
    });

    it('should clear location ID but preserve location data', () => {
      const originalEvent = createFullTestEvent();
      const duplicatedEvent = EventService.prepareEventForDuplication(originalEvent);

      expect(duplicatedEvent.location?.id).toBe('');
      expect(duplicatedEvent.location?.name).toBe('Test Venue');
      expect(duplicatedEvent.location?.address).toBe('123 Test St');
      expect(duplicatedEvent.location?.city).toBe('Test City');
    });

    it('should clear media ID but preserve media data', () => {
      const originalEvent = createFullTestEvent();
      const duplicatedEvent = EventService.prepareEventForDuplication(originalEvent);

      expect(duplicatedEvent.media?.id).toBe('');
      expect(duplicatedEvent.media?.originalFilename).toBe('test-image.jpg');
      expect(duplicatedEvent.media?.mimeType).toBe('image/jpeg');
    });

    it('should clear schedule IDs but preserve schedule data', () => {
      const originalEvent = createFullTestEvent();
      const duplicatedEvent = EventService.prepareEventForDuplication(originalEvent);

      expect(duplicatedEvent.schedules).toHaveLength(1);
      expect(duplicatedEvent.schedules[0].id).toBe('');
    });

    it('should clear category IDs but preserve category data', () => {
      const originalEvent = createFullTestEvent();
      const duplicatedEvent = EventService.prepareEventForDuplication(originalEvent);

      expect(duplicatedEvent.categories).toHaveLength(1);
      expect(duplicatedEvent.categories[0].id).toBe('');
      expect(duplicatedEvent.categories[0].content('en').name).toBe('Test Category');
    });

    it('should handle event with minimal data', () => {
      const originalEvent = new CalendarEvent('event-id', 'calendar-id');
      const duplicatedEvent = EventService.prepareEventForDuplication(originalEvent);

      expect(duplicatedEvent.id).toBe('');
      expect(duplicatedEvent.calendarId).toBe('calendar-id');
      expect(duplicatedEvent.location).toBe(null);
      expect(duplicatedEvent.media).toBe(null);
      expect(duplicatedEvent.schedules).toHaveLength(0);
      expect(duplicatedEvent.categories).toHaveLength(0);
    });
  });

  describe('Edit Event Component in Duplication Mode (Route-Based)', () => {
    it('should display duplication mode context in UI', async () => {
      const calendar = new Calendar('calendar-id', 'test-calendar');
      calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

      // Mock axios.get for loading source event
      sandbox.stub(axios, 'get').resolves({
        data: {
          id: 'event-id',
          calendarId: 'calendar-id',
          schedules: [],
          content: { en: { language: 'en', name: 'Test Event', description: 'Test Description' } },
          location: { name: 'Test Venue', address: '123 Test St' },
          categories: [],
        },
      });

      const { wrapper } = await mountedEditorOnRoute('/event?from=event-id', [calendar]);
      currentWrapper = wrapper;

      // Component should be mounted
      expect(wrapper.exists()).toBe(true);

      // Should show duplicate title (either translation key or translated text)
      const header = wrapper.find('.page-header h1');
      const headerText = header.text().toLowerCase();
      expect(headerText).toMatch(/duplicate/i);
    });

    it('should initialize form with source event data via route query', async () => {
      const calendar = new Calendar('calendar-id', 'test-calendar');
      calendar.addContent({ language: 'en', name: 'Test Calendar', description: '' });

      // Mock axios.get for loading source event
      sandbox.stub(axios, 'get').resolves({
        data: {
          id: 'event-id',
          calendarId: 'calendar-id',
          schedules: [],
          content: { en: { language: 'en', name: 'Test Event', description: 'Test Description' } },
          location: { name: 'Test Venue', address: '123 Test St' },
          categories: [],
        },
      });

      const { wrapper, router } = await mountedEditorOnRoute('/event?from=event-id', [calendar]);
      currentWrapper = wrapper;

      // Verify route has from query parameter
      expect(router.currentRoute.value.query.from).toBe('event-id');

      // Component should be mounted with form
      expect(wrapper.find('form').exists()).toBe(true);
    });

    it('should preserve all event data except IDs when duplicating', () => {
      const originalEvent = createFullTestEvent();
      const duplicatedEvent = EventService.prepareEventForDuplication(originalEvent);

      // Verify content is preserved
      expect(duplicatedEvent.content('en').name).toBe(originalEvent.content('en').name);
      expect(duplicatedEvent.content('en').description).toBe(originalEvent.content('en').description);

      // Verify location data is preserved (but ID is cleared)
      expect(duplicatedEvent.location?.name).toBe(originalEvent.location?.name);
      expect(duplicatedEvent.location?.address).toBe(originalEvent.location?.address);
      expect(duplicatedEvent.location?.id).toBe('');

      // Verify media data is preserved (but ID is cleared)
      expect(duplicatedEvent.media?.originalFilename).toBe(originalEvent.media?.originalFilename);
      expect(duplicatedEvent.media?.mimeType).toBe(originalEvent.media?.mimeType);
      expect(duplicatedEvent.media?.id).toBe('');

      // Verify categories are preserved (but IDs are cleared)
      expect(duplicatedEvent.categories).toHaveLength(1);
      expect(duplicatedEvent.categories[0].content('en').name).toBe('Test Category');
      expect(duplicatedEvent.categories[0].id).toBe('');
    });
  });
});
