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
 * - Default image fallback: event.media ?? (isRepost ? null : defaultImage) ?? null
 * - Source calendar pill renders for reposted events with sourceCalendar data.
 * - Source calendar pill does NOT render when sourceCalendar is null.
 * - Source calendar pill displays urlName@host format.
 * - Source calendar pill links to source calendar URL.
 * - Remote source calendar links open in new tab.
 * - Cancelled badge renders when instance.isCancelled is true; hidden otherwise.
 * - Card receives a cancelled de-emphasis class when instance.isCancelled is true.
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
import { EventLocationSpace, EventLocationSpaceContent } from '@/common/model/location';

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
    props: ['media', 'context', 'alt', 'focalPointX', 'focalPointY', 'zoom'],
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
    space: overrides.space ?? null,
    media: overrides.media ?? null,
    mediaFocalPointX: overrides.mediaFocalPointX ?? 0.5,
    mediaFocalPointY: overrides.mediaFocalPointY ?? 0.5,
    mediaZoom: overrides.mediaZoom ?? 1.0,
    categories: overrides.categories ?? [],
    isRecurring: overrides.isRecurring ?? false,
    isRepost: overrides.isRepost ?? false,
    sourceCalendar: overrides.sourceCalendar ?? null,
    series: null,
  };
  return event as unknown as CalendarEvent;
}

/**
 * Build a Space (EventLocationSpace) with a single English content entry so
 * the locationDisplayName computed on the card renders "Place — Space".
 */
function makeSpace(name: string): EventLocationSpace {
  const space = new EventLocationSpace('space-1', 'place-1');
  space.addContent(new EventLocationSpaceContent('en', name, ''));
  return space;
}

/**
 * Create a CalendarEventInstance with given start/end times.
 */
function makeInstance(
  event: CalendarEvent,
  startISO: string,
  endISO?: string,
  opts: { isCancelled?: boolean } = {},
): CalendarEventInstance {
  const start = DateTime.fromISO(startISO);
  const end = endISO ? DateTime.fromISO(endISO) : null;
  const instance = new CalendarEventInstance('inst-1', event, start, end);
  if (opts.isCancelled !== undefined) {
    instance.isCancelled = opts.isCancelled;
  }
  return instance;
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
async function mountEventCard(
  instance: CalendarEventInstance,
  calendarUrlName = 'test-calendar',
  extraProps: Record<string, any> = {},
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/view/:calendar', component: { template: '<div />' }, name: 'calendar' },
      { path: '/view/:calendar/events/:event/:startTime(\\d{8}-\\d{4})', component: { template: '<div />' }, name: 'instance' },
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
      ...extraProps,
    },
  });

  await flushPromises();
  return wrapper;
}

// ---------------------------------------------------------------------------
// i18next initialisation
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const systemBundle = {
    event_recurring: 'Recurring Event',
    event_location: 'Location',
    event_source_calendar: 'Source Calendar',
    event_source_calendar_label: 'View source calendar {{name}}',
    event_cancelled: 'Cancelled',
    place: {
      format: {
        with_space: '{{place}} — {{space}}',
      },
    },
  };
  if (!i18next.isInitialized) {
    await i18next.init({
      lng: 'en',
      resources: {
        en: {
          system: systemBundle,
        },
      },
    });
  }
  else {
    i18next.addResourceBundle('en', 'system', systemBundle, true, true);
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

    it('should wrap title in a link pointing to the event detail page using a timestamp slug', async () => {
      const event = makeEvent({ name: 'My Event' });
      (event as any).id = 'evt-abc';
      // Use a UTC ISO so the slug is deterministic regardless of host timezone.
      const instance = makeInstance(event, '2026-05-08T18:00:00.000Z');
      (instance as any).id = 'inst-xyz';
      const wrapper = await mountEventCard(instance, 'my-calendar');

      const link = wrapper.find('.event-title-link');
      expect(link.exists()).toBe(true);
      const href = link.attributes('href') ?? '';
      expect(href).toContain('/view/my-calendar/events/evt-abc/20260508-1800');
      wrapper.unmount();
    });

    it('should fall back to localizedPath when detailHref is omitted', async () => {
      const event = makeEvent({ name: 'Default Path Event' });
      (event as any).id = 'evt-default';
      const instance = makeInstance(event, '2026-06-10T12:00:00.000Z');
      const wrapper = await mountEventCard(instance, 'site-cal');

      const link = wrapper.find('.event-title-link');
      expect(link.exists()).toBe(true);
      // Without detailHref, the href is the site-computed localizedPath value.
      expect(link.attributes('href')).toBe('/view/site-cal/events/evt-default/20260610-1200');
      wrapper.unmount();
    });

    it('should use detailHref directly when prop is provided', async () => {
      const event = makeEvent({ name: 'Widget Hosted Event' });
      (event as any).id = 'evt-widget';
      const instance = makeInstance(event, '2026-06-10T12:00:00.000Z');
      const wrapper = await mountEventCard(instance, 'site-cal', {
        detailHref: '/widget/some/path?event=evt-widget',
      });

      const link = wrapper.find('.event-title-link');
      expect(link.exists()).toBe(true);
      // detailHref short-circuits the localizedPath computation.
      expect(link.attributes('href')).toBe('/widget/some/path?event=evt-widget');
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

    // Regression for pv-vvei: when an event is scoped to a Place + Space,
    // the card must render "Place — Space", not just the Place name. The
    // detail page already used this format via a `locationDisplayName`
    // computed; the card was missing the same logic.
    it('should render "Place — Space" when the event has a Space', async () => {
      const event = makeEvent({
        location: { name: 'Library Annex', address: '', city: '', state: '', postalCode: '', country: '' },
        space: makeSpace('Reading Room'),
      });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      const locationEl = wrapper.find('.event-location');
      expect(locationEl.exists()).toBe(true);
      expect(locationEl.text()).toContain('Library Annex — Reading Room');
      wrapper.unmount();
    });

    it('should render only the Place name when there is no Space (whole-venue)', async () => {
      const event = makeEvent({
        location: { name: 'Park Pavilion', address: '', city: '', state: '', postalCode: '', country: '' },
        space: null,
      });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      const locationEl = wrapper.find('.event-location');
      expect(locationEl.exists()).toBe(true);
      expect(locationEl.text()).toContain('Park Pavilion');
      expect(locationEl.text()).not.toContain('—');
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

  describe('default image fallback', () => {
    const defaultImage = { id: 'default-img-1', mimeType: 'image/jpeg' };

    it('should use event media when event has its own image (ignoring defaultImage)', async () => {
      const eventMedia = { id: 'event-media-1', originalFilename: 'event-photo.jpg' };
      const event = makeEvent({ media: eventMedia });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance, 'test-calendar', { defaultImage });

      // EventImage stub should be rendered (media is present)
      expect(wrapper.find('.event-image-stub').exists()).toBe(true);
      // No-image fallback should NOT be shown
      expect(wrapper.find('.no-image-fallback').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should use defaultImage when event has no media and is not a repost', async () => {
      const event = makeEvent({ media: null, isRepost: false });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance, 'test-calendar', { defaultImage });

      // EventImage stub should be rendered (defaultImage used as fallback)
      expect(wrapper.find('.event-image-stub').exists()).toBe(true);
      // No-image fallback should NOT be shown since defaultImage is provided
      expect(wrapper.find('.no-image-fallback').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should NOT use defaultImage when event is a repost without media', async () => {
      const event = makeEvent({ media: null, isRepost: true });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance, 'test-calendar', { defaultImage });

      // No-image fallback should be shown (repost suppresses default image)
      expect(wrapper.find('.no-image-fallback').exists()).toBe(true);
      wrapper.unmount();
    });

    it('should show no-image fallback when no media and no defaultImage provided', async () => {
      const event = makeEvent({ media: null, isRepost: false });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance, 'test-calendar');

      // No defaultImage prop passed, so fallback SVG should render
      expect(wrapper.find('.no-image-fallback').exists()).toBe(true);
      wrapper.unmount();
    });

    it('should use event media even when event is a repost with its own media', async () => {
      const eventMedia = { id: 'repost-media-1', originalFilename: 'repost-photo.jpg' };
      const event = makeEvent({ media: eventMedia, isRepost: true });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance, 'test-calendar', { defaultImage });

      // Event's own media takes priority even for reposts
      expect(wrapper.find('.event-image-stub').exists()).toBe(true);
      expect(wrapper.find('.no-image-fallback').exists()).toBe(false);
      wrapper.unmount();
    });
  });

  describe('source calendar pill', () => {
    it('should show source calendar pill when event has sourceCalendar', async () => {
      const event = makeEvent({
        sourceCalendar: {
          urlName: 'community-events',
          host: 'other.instance.org',
          url: 'https://other.instance.org/view/community-events',
        },
      });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      const pill = wrapper.find('.source-calendar-pill');
      expect(pill.exists()).toBe(true);
      wrapper.unmount();
    });

    it('should not show source calendar pill when sourceCalendar is null', async () => {
      const event = makeEvent({ sourceCalendar: null });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      expect(wrapper.find('.source-calendar-pill').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should display urlName@host format in the pill text', async () => {
      const event = makeEvent({
        sourceCalendar: {
          urlName: 'downtown-cal',
          host: 'events.city.gov',
          url: 'https://events.city.gov/view/downtown-cal',
        },
      });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      const pill = wrapper.find('.source-calendar-pill');
      expect(pill.text()).toContain('downtown-cal@events.city.gov');
      wrapper.unmount();
    });

    it('should link to the source calendar URL', async () => {
      const event = makeEvent({
        sourceCalendar: {
          urlName: 'my-cal',
          host: 'example.com',
          url: 'https://example.com/view/my-cal',
        },
      });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      const pill = wrapper.find('.source-calendar-pill');
      expect(pill.attributes('href')).toBe('https://example.com/view/my-cal');
      wrapper.unmount();
    });

    it('should open remote links in a new tab with noopener noreferrer', async () => {
      const event = makeEvent({
        sourceCalendar: {
          urlName: 'remote-cal',
          host: 'remote.org',
          url: 'https://remote.org/view/remote-cal',
        },
      });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      const pill = wrapper.find('.source-calendar-pill');
      expect(pill.attributes('target')).toBe('_blank');
      expect(pill.attributes('rel')).toBe('noopener noreferrer');
      wrapper.unmount();
    });

    it('should have an aria-label with the source calendar name', async () => {
      const event = makeEvent({
        sourceCalendar: {
          urlName: 'arts-cal',
          host: 'arts.org',
          url: 'https://arts.org/view/arts-cal',
        },
      });
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      const pill = wrapper.find('.source-calendar-pill');
      expect(pill.attributes('aria-label')).toContain('arts-cal@arts.org');
      wrapper.unmount();
    });
  });

  describe('cancelled badge and de-emphasis', () => {
    it('should render the cancelled badge when isCancelled is true', async () => {
      const event = makeEvent();
      const instance = makeInstance(event, '2026-07-15T19:00:00', undefined, { isCancelled: true });
      const wrapper = await mountEventCard(instance);

      const badge = wrapper.find('.cancelled-badge');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toContain('Cancelled');
      wrapper.unmount();
    });

    it('should not render the cancelled badge when isCancelled is false', async () => {
      const event = makeEvent();
      const instance = makeInstance(event, '2026-07-15T19:00:00', undefined, { isCancelled: false });
      const wrapper = await mountEventCard(instance);

      expect(wrapper.find('.cancelled-badge').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should not render the cancelled badge when isCancelled is not set', async () => {
      const event = makeEvent();
      const instance = makeInstance(event, '2026-07-15T19:00:00');
      const wrapper = await mountEventCard(instance);

      expect(wrapper.find('.cancelled-badge').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should apply the is-cancelled de-emphasis class to the card when isCancelled is true', async () => {
      const event = makeEvent();
      const instance = makeInstance(event, '2026-07-15T19:00:00', undefined, { isCancelled: true });
      const wrapper = await mountEventCard(instance);

      const card = wrapper.find('.event-card');
      expect(card.exists()).toBe(true);
      expect(card.classes()).toContain('is-cancelled');
      wrapper.unmount();
    });

    it('should not apply the is-cancelled class to the card when isCancelled is false', async () => {
      const event = makeEvent();
      const instance = makeInstance(event, '2026-07-15T19:00:00', undefined, { isCancelled: false });
      const wrapper = await mountEventCard(instance);

      const card = wrapper.find('.event-card');
      expect(card.exists()).toBe(true);
      expect(card.classes()).not.toContain('is-cancelled');
      wrapper.unmount();
    });
  });
});
