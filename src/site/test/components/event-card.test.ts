/**
 * Tests for the EventCard component.
 *
 * Validates:
 * - Event title renders with a link to the detail page.
 * - Time range is formatted via Luxon DateTime.TIME_SIMPLE.
 * - Location is shown with MapPin icon when present; hidden when absent.
 * - Description is rendered (CSS line-clamp applied, no JS truncation).
 * - Category badges are rendered for each assigned category.
 * - Recurrence badge shows when isRecurring is true; hidden when false.
 * - No-image fallback renders when event has no media.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createPinia } from 'pinia';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import { DateTime } from 'luxon';

import { EventCategory } from '@/common/model/event_category';
import { EventCategoryContent } from '@/common/model/event_category_content';
import { CalendarEvent } from '@/common/model/events';
import CalendarEventInstance from '@/common/model/event_instance';

// ---------------------------------------------------------------------------
// Mocks — declared before component import
// ---------------------------------------------------------------------------

vi.mock('@/site/composables/useLocale', () => ({
  useLocale: () => ({
    currentLocale: { value: 'en' },
    switchLocale: vi.fn(),
    localizedPath: (path: string) => path,
  }),
}));

vi.mock('@/site/components/event-image.vue', () => ({
  default: {
    template: '<div class="event-image-stub"></div>',
    props: ['media', 'context', 'alt'],
  },
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------
import EventCard from '@/site/components/event-card.vue';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal CalendarEvent-like object suitable for testing EventCard.
 * We use a plain object cast to avoid needing a real CalendarEvent factory
 * while still satisfying the component's usage pattern.
 */
function makeEvent(overrides: Record<string, any> = {}): CalendarEvent {
  const event = {
    id: 'event-1',
    calendarId: 'cal-1',
    content: (_lang: string) => ({
      name: overrides.name ?? 'Test Event',
      description: overrides.description ?? 'A description of the event.',
    }),
    hasContent: (_lang: string) => true,
    getLanguages: () => ['en'],
    location: overrides.location ?? null,
    media: overrides.media ?? null,
    categories: overrides.categories ?? [],
    isRecurring: overrides.isRecurring ?? false,
    series: null,
  };
  return event as unknown as CalendarEvent;
}

/**
 * Create a CalendarEventInstance with given start/end times.
 */
function makeInstance(
  event: CalendarEvent,
  startISO: string,
  endISO?: string,
): CalendarEventInstance {
  const start = DateTime.fromISO(startISO);
  const end = endISO ? DateTime.fromISO(endISO) : null;
  return new CalendarEventInstance('inst-1', event, start, end);
}

/**
 * Create a category with one English translation.
 */
function makeCategory(id: string, name: string): EventCategory {
  const cat = new EventCategory(id, 'cal-1');
  const content = new EventCategoryContent('en', name);
  cat.addContent(content);
  return cat;
}

/**
 * Mount EventCard with the required plugins.
 */
async function mountEventCard(instance: CalendarEventInstance, calendarUrlName = 'test-calendar') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/view/:calendar', component: { template: '<div />' }, name: 'calendar' },
      { path: '/view/:calendar/events/:event/:instance', component: { template: '<div />' }, name: 'instance' },
    ],
  });
  await router.push('/view/test-calendar');
  await router.isReady();

  const pinia = createPinia();

  const wrapper = mount(EventCard, {
    global: {
      plugins: [
        router,
        [I18NextVue, { i18next }],
        pinia,
      ],
    },
    props: {
      instance,
      calendarUrlName,
    },
  });

  await flushPromises();
  return wrapper;
}

// ---------------------------------------------------------------------------
// i18next initialisation
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (!i18next.isInitialized) {
    await i18next.init({
      lng: 'en',
      resources: {
        en: {
          system: {
            event_recurring: 'Recurring Event',
            event_location: 'Location',
          },
        },
      },
    });
  }
  else {
    i18next.addResourceBundle('en', 'system', {
      event_recurring: 'Recurring Event',
      event_location: 'Location',
    }, true, true);
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EventCard', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('renders event title with link to detail page', () => {
    it('should display the event title', async () => {
      const event = makeEvent({ name: 'Summer Concert' });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      expect(wrapper.find('h3').text()).toBe('Summer Concert');
      wrapper.unmount();
    });

    it('should wrap title in a link pointing to the event detail page', async () => {
      const event = makeEvent({ name: 'My Event' });
      (event as any).id = 'evt-abc';
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      (instance as any).id = 'inst-xyz';
      const wrapper = await mountEventCard(instance, 'my-calendar');

      const link = wrapper.find('.event-title-link');
      expect(link.exists()).toBe(true);
      const href = link.attributes('href') ?? '';
      expect(href).toContain('/view/my-calendar/events/evt-abc/inst-xyz');
      wrapper.unmount();
    });
  });

  describe('time range display', () => {
    it('should display the start time when no end time is set', async () => {
      const event = makeEvent();
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      const timeEl = wrapper.find('.event-time');
      expect(timeEl.exists()).toBe(true);
      // Should contain some time string (Luxon TIME_SIMPLE format)
      expect(timeEl.text()).toBeTruthy();
      wrapper.unmount();
    });

    it('should display a time range with em-dash separator when end time is provided', async () => {
      const event = makeEvent();
      const instance = makeInstance(event, '2026-07-15T19:00:00', '2026-07-15T22:00:00');
      const wrapper = await mountEventCard(instance);

      const timeEl = wrapper.find('.event-time');
      expect(timeEl.exists()).toBe(true);
      expect(timeEl.text()).toContain('–');
      wrapper.unmount();
    });
  });

  describe('location display', () => {
    it('should show location with name when location is present', async () => {
      const event = makeEvent({
        location: {
          name: 'Community Center',
          address: '123 Main St',
          city: '',
          state: '',
          postalCode: '',
          country: '',
        },
      });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      const locationEl = wrapper.find('.event-location');
      expect(locationEl.exists()).toBe(true);
      expect(locationEl.text()).toContain('Community Center');
      wrapper.unmount();
    });

    it('should hide location element when no location is set', async () => {
      const event = makeEvent({ location: null });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      expect(wrapper.find('.event-location').exists()).toBe(false);
      wrapper.unmount();
    });
  });

  describe('description display', () => {
    it('should render the event description', async () => {
      const event = makeEvent({ description: 'Join us for an exciting outdoor concert.' });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      const descEl = wrapper.find('.event-description');
      expect(descEl.exists()).toBe(true);
      expect(descEl.text()).toContain('Join us for an exciting outdoor concert.');
      wrapper.unmount();
    });

    it('should not render description element when description is empty', async () => {
      const event = makeEvent({ description: '' });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      expect(wrapper.find('.event-description').exists()).toBe(false);
      wrapper.unmount();
    });
  });

  describe('category badges', () => {
    it('should render one badge per category', async () => {
      const cats = [
        makeCategory('cat-1', 'Music'),
        makeCategory('cat-2', 'Outdoor'),
        makeCategory('cat-3', 'Family'),
      ];
      const event = makeEvent({ categories: cats });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      const badges = wrapper.findAll('.category-badge');
      expect(badges.length).toBe(3);
      wrapper.unmount();
    });

    it('should display the category name in each badge', async () => {
      const cats = [makeCategory('cat-1', 'Arts'), makeCategory('cat-2', 'Sports')];
      const event = makeEvent({ categories: cats });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      const badges = wrapper.findAll('.category-badge');
      expect(badges[0].text()).toBe('Arts');
      expect(badges[1].text()).toBe('Sports');
      wrapper.unmount();
    });

    it('should render no badges when event has no categories', async () => {
      const event = makeEvent({ categories: [] });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      expect(wrapper.findAll('.category-badge').length).toBe(0);
      wrapper.unmount();
    });
  });

  describe('recurrence badge', () => {
    it('should show the recurrence badge when isRecurring is true', async () => {
      const event = makeEvent({ isRecurring: true });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      const badge = wrapper.find('.recurrence-badge');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toContain('Recurring Event');
      wrapper.unmount();
    });

    it('should hide the recurrence badge when isRecurring is false', async () => {
      const event = makeEvent({ isRecurring: false });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      expect(wrapper.find('.recurrence-badge').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should hide the recurrence badge when isRecurring is not set', async () => {
      const event = makeEvent();
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      expect(wrapper.find('.recurrence-badge').exists()).toBe(false);
      wrapper.unmount();
    });
  });

  describe('image and no-image fallback', () => {
    it('should render EventImage when media is present', async () => {
      const event = makeEvent({ media: { id: 'media-1', originalFilename: 'photo.jpg' } });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      // The stubbed EventImage renders with class event-image-stub
      expect(wrapper.find('.event-image-stub').exists()).toBe(true);
      wrapper.unmount();
    });

    it('should render no-image fallback when media is null', async () => {
      const event = makeEvent({ media: null });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      expect(wrapper.find('.no-image-fallback').exists()).toBe(true);
      wrapper.unmount();
    });
  });
});
