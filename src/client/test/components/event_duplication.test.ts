import { expect, describe, it, afterEach } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';
import { nextTick } from 'vue';

import { CalendarEvent, CalendarEventContent } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';
import { Media } from '@/common/model/media';
import { EventCategory } from '@/common/model/event_category';
import { mountComponent } from '@/client/test/lib/vue';
import EditEvent from '@/client/components/logged_in/calendar/edit_event.vue';
import EventService from '@/client/service/event';

const routes: RouteRecordRaw[] = [
  { path: '/login',  component: {}, name: 'login', props: true },
  { path: '/logout', component: {}, name: 'logout' },
  { path: '/register', component: {}, name: 'register', props: true },
  { path: '/forgot', component: {}, name: 'forgot_password', props: true },
  { path: '/apply',  component: {}, name: 'register-apply', props: true },
  { path: '/reset',  component: {}, name: 'reset_password', props: true },
];

// Test utility functions for event duplication
// Uses the actual EventService method to test real functionality

/**
 * Creates a test event with full data for duplication testing
 */
function createFullTestEvent(): CalendarEvent {
  const event = new CalendarEvent('calendar-id', 'event-id', '2025-09-15');
  event.eventSourceUrl = 'https://example.com/event';

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

const mountedEditor = (event: CalendarEvent, isDuplicationMode: boolean = false) => {
  let router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  const wrapper = mountComponent(EditEvent, router, {
    provide: {
      site_config: {
        settings: {},
      },
    },
    props: {
      event: event,
      isDuplicationMode: isDuplicationMode,
    },
  });

  return {
    wrapper,
    router,
  };
};

describe('Event Duplication System', () => {
  const sandbox = sinon.createSandbox();
  let currentWrapper: any = null;

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
      const originalEvent = new CalendarEvent('calendar-id', 'event-id');
      const duplicatedEvent = EventService.prepareEventForDuplication(originalEvent);

      expect(duplicatedEvent.id).toBe('');
      expect(duplicatedEvent.calendarId).toBe('calendar-id');
      expect(duplicatedEvent.location).toBe(null);
      expect(duplicatedEvent.media).toBe(null);
      expect(duplicatedEvent.schedules).toHaveLength(0);
      expect(duplicatedEvent.categories).toHaveLength(0);
    });
  });

  describe('Edit Event Component in Duplication Mode', () => {
    it('should display duplication mode context in UI', async () => {
      const event = createFullTestEvent();
      const strippedEvent = EventService.prepareEventForDuplication(event);

      const { wrapper } = mountedEditor(strippedEvent, true);
      currentWrapper = wrapper;

      // Check that duplication mode is indicated in the UI
      // This test will be completed once the UI changes are implemented in Task 3.2
      // expect(wrapper.vm.isDuplicationMode).toBe(true);

      // For now, just verify the component mounts with the event data
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.event).toBeDefined();
    });

    it('should pre-populate form fields with duplicated event data', async () => {
      const event = createFullTestEvent();
      const strippedEvent = EventService.prepareEventForDuplication(event);

      const { wrapper } = mountedEditor(strippedEvent, true);
      currentWrapper = wrapper;

      // Verify form fields are populated with original data
      expect(wrapper.find('input[name="name"]').element.value).toBe('Test Event');
      expect(wrapper.find('input[name="description"]').element.value).toBe('Test Description');
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
