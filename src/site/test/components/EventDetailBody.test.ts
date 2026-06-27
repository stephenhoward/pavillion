/**
 * Tests for EventDetailBody.vue.
 *
 * EventDetailBody is the shared presentational body of the event detail
 * page. It renders the hero image, badges, source-calendar pill, title,
 * datetime row, and the two-column grid of description/categories +
 * sidebar info cards (location, accessibility, recurrence) + external
 * CTA + AddToCalendar.
 *
 * Validates:
 *  - Happy-path rendering of each region given a populated instance.
 *  - The `categoryHrefBuilder` prop seam: function → categories render as
 *    `<a>`, undefined → categories render as `<span>`.
 *  - CTA security guards (moved from the widget overlay test):
 *    - javascript: / data: / malformed URLs blocked
 *    - unknown urlPrompt blocked
 *    - null externalUrl OR null urlPrompt → CTA omitted
 *    - valid http/https + known prompt → CTA rendered with target=_blank
 *      and rel=noopener noreferrer
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import { DateTime } from 'luxon';

import { EventCategory } from '@/common/model/event_category';
import { EventCategoryContent } from '@/common/model/event_category_content';

// ---------------------------------------------------------------------------
// Mocks — declared before component import
// ---------------------------------------------------------------------------

// Mock useLocale so useLocalizedContent doesn't reach for vue-router; the
// component is presentational and never builds URLs itself.
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

vi.mock('@/site/components/add-to-calendar.vue', () => ({
  default: {
    template: '<div class="add-to-calendar-stub"></div>',
    props: ['event', 'instance'],
  },
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------
import EventDetailBody from '@/site/components/EventDetailBody.vue';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

interface InstanceOverrides {
  media?: any;
  categories?: EventCategory[];
  location?: any;
  space?: any;
  recurrenceSummary?: any;
  sourceCalendar?: any;
  externalUrl?: string | null;
  urlPrompt?: string | null;
  isCancelled?: boolean;
  end?: any;
  accessibilityInfo?: string;
}

/**
 * Builds a mock Place (EventLocation) with optional accessibility info.
 */
function makePlace(opts: {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  accessibilityInfo?: Record<string, string>;
} = {}): any {
  const accessibility = opts.accessibilityInfo ?? {};
  return {
    name: opts.name ?? 'Convention Center',
    address: opts.address ?? '100 Main St',
    city: opts.city ?? 'Springfield',
    state: opts.state ?? 'IL',
    postalCode: opts.postalCode ?? '62701',
    hasContent: (lang: string) => lang in accessibility,
    content: (lang: string) => ({
      language: lang,
      accessibilityInfo: accessibility[lang] ?? accessibility['en'] ?? '',
    }),
    getLanguages: () => Object.keys(accessibility),
  };
}

/**
 * Builds a mock Space (EventLocationSpace) with optional name and accessibility info.
 */
function makeSpace(opts: {
  name?: string;
  accessibilityInfo?: Record<string, string>;
  language?: string;
} = {}): any {
  const lang = opts.language ?? 'en';
  const name = opts.name ?? 'Pacific Room';
  const accessibility = opts.accessibilityInfo ?? {};
  // Space content lookup must always return an object whose `name` is the
  // space name (the picker emits this when a Space is chosen).
  return {
    hasContent: (l: string) => l === lang || l in accessibility,
    content: (l: string) => ({
      language: l,
      name,
      accessibilityInfo: accessibility[l] ?? accessibility['en'] ?? '',
    }),
    getLanguages: () => [lang, ...Object.keys(accessibility).filter(k => k !== lang)],
  };
}

function makeCategory(id: string, name: string): EventCategory {
  const cat = new EventCategory(id, 'cal-1');
  const content = new EventCategoryContent('en', name);
  cat.addContent(content);
  return cat;
}

function makeInstance(overrides: InstanceOverrides = {}): any {
  const start = DateTime.fromISO('2026-05-08T18:00:00.000Z');
  const end = overrides.end === undefined ? null : overrides.end;

  return {
    id: 'inst-1',
    start,
    end,
    isCancelled: overrides.isCancelled ?? false,
    event: {
      id: 'evt-1',
      content: (_lang: string) => ({
        name: 'Test Event',
        description: 'A description of the event.',
        accessibilityInfo: overrides.accessibilityInfo ?? '',
      }),
      hasContent: (_lang: string) => true,
      getLanguages: () => ['en'],
      media: overrides.media ?? null,
      mediaFocalPointX: 0.5,
      mediaFocalPointY: 0.5,
      mediaZoom: 1.0,
      categories: overrides.categories ?? [],
      recurrenceSummary: overrides.recurrenceSummary ?? null,
      location: overrides.location ?? null,
      space: overrides.space ?? null,
      sourceCalendar: overrides.sourceCalendar ?? null,
      externalUrl: overrides.externalUrl ?? null,
      urlPrompt: overrides.urlPrompt ?? null,
    },
  };
}

function mountBody(props: {
  instance: any;
  categoryHrefBuilder?: (cat: EventCategory) => string;
}): VueWrapper {
  const pinia = createPinia();
  return mount(EventDetailBody, {
    global: {
      plugins: [
        [I18NextVue, { i18next }],
        pinia,
      ],
    },
    props: {
      instance: props.instance,
      categoryHrefBuilder: props.categoryHrefBuilder,
    },
  });
}

// ---------------------------------------------------------------------------
// i18next initialisation
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const resources = {
    about_this_event: 'About This Event',
    event_categories: 'Categories',
    event_location: 'Location',
    accessibility: {
      section_heading: 'Accessibility',
      event_label: 'Event accessibility',
      venue_label: 'Venue accessibility',
      space_label: 'Space accessibility',
    },
    event_recurring: 'Recurring',
    event_cancelled: 'Cancelled',
    event_source_calendar_label: 'View source calendar {{name}}',
    get_directions: 'Get directions',
    url_prompt: {
      tickets: 'Tickets',
      rsvp: 'RSVP',
      more_info: 'More Information',
      register: 'Register',
    },
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
          system: resources,
        },
      },
    });
  }
  else {
    i18next.addResourceBundle('en', 'system', resources, true, true);
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EventDetailBody', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('happy-path rendering', () => {
    it('renders the hero image when instance.event.media is present', () => {
      const wrapper = mountBody({
        instance: makeInstance({ media: { id: 'media-1', url: 'image.jpg' } }),
      });
      expect(wrapper.find('.hero-image-wrapper').exists()).toBe(true);
      expect(wrapper.find('.event-image-stub').exists()).toBe(true);
      wrapper.unmount();
    });

    it('does not render the hero image when instance.event.media is null', () => {
      const wrapper = mountBody({ instance: makeInstance() });
      expect(wrapper.find('.hero-image-wrapper').exists()).toBe(false);
      wrapper.unmount();
    });

    it('renders the title from localizedContent(instance.event).name', () => {
      const wrapper = mountBody({ instance: makeInstance() });
      expect(wrapper.find('.instance-title').text()).toBe('Test Event');
      wrapper.unmount();
    });

    it('renders the datetime row with date and time elements', () => {
      const wrapper = mountBody({ instance: makeInstance() });
      expect(wrapper.find('.datetime-row').exists()).toBe(true);
      expect(wrapper.find('.event-date').exists()).toBe(true);
      expect(wrapper.find('.event-datetime').exists()).toBe(true);
      wrapper.unmount();
    });

    it('renders the description', () => {
      const wrapper = mountBody({ instance: makeInstance() });
      expect(wrapper.find('.event-description').text()).toBe('A description of the event.');
      wrapper.unmount();
    });

    it('renders the categories list when categories are present', () => {
      const cats = [
        makeCategory('cat-1', 'Music'),
        makeCategory('cat-2', 'Outdoors'),
      ];
      const wrapper = mountBody({ instance: makeInstance({ categories: cats }) });
      expect(wrapper.find('.categories-section').exists()).toBe(true);
      const badges = wrapper.findAll('.event-category-badge');
      expect(badges).toHaveLength(2);
      expect(badges[0].text()).toBe('Music');
      expect(badges[1].text()).toBe('Outdoors');
      wrapper.unmount();
    });

    it('does not render the categories section when categories are empty', () => {
      const wrapper = mountBody({ instance: makeInstance() });
      expect(wrapper.find('.categories-section').exists()).toBe(false);
      wrapper.unmount();
    });

    it('renders the location sidebar card when location is present', () => {
      const wrapper = mountBody({
        instance: makeInstance({
          location: {
            name: 'Town Hall',
            address: '123 Main St',
            city: 'Anytown',
            state: 'CA',
            postalCode: '94000',
          },
        }),
      });
      expect(wrapper.find('.event-location').exists()).toBe(true);
      expect(wrapper.find('.location-name').text()).toBe('Town Hall');
      expect(wrapper.find('.location-address').exists()).toBe(true);
      wrapper.unmount();
    });

    it('renders the accessibility card when venue (Place) accessibility info is present', () => {
      const wrapper = mountBody({
        instance: makeInstance({
          location: makePlace({
            accessibilityInfo: { en: 'Wheelchair ramp at side entrance.' },
          }),
        }),
      });
      expect(wrapper.find('.accessibility-card').exists()).toBe(true);
      expect(wrapper.find('.accessibility-info').text()).toBe('Wheelchair ramp at side entrance.');
      wrapper.unmount();
    });

    it('renders the recurrence card when recurrenceSummary is present', () => {
      const wrapper = mountBody({
        instance: makeInstance({
          recurrenceSummary: { key: 'recurrence.weekly', params: {} },
        }),
      });
      expect(wrapper.find('.recurrence-card').exists()).toBe(true);
      expect(wrapper.find('.recurrence-badge').exists()).toBe(true);
      wrapper.unmount();
    });

    it('renders the external CTA when externalUrl + urlPrompt are valid', () => {
      const wrapper = mountBody({
        instance: makeInstance({
          externalUrl: 'https://example.com/tix',
          urlPrompt: 'tickets',
        }),
      });
      const cta = wrapper.find('.external-link-button');
      expect(cta.exists()).toBe(true);
      expect(cta.attributes('href')).toBe('https://example.com/tix');
      expect(cta.text()).toContain('Tickets');
      wrapper.unmount();
    });

    it('renders <AddToCalendar> in the right column', () => {
      const wrapper = mountBody({ instance: makeInstance() });
      expect(wrapper.find('.add-to-calendar-stub').exists()).toBe(true);
      wrapper.unmount();
    });

    it('renders the cancelled badge when instance.isCancelled is true', () => {
      const wrapper = mountBody({ instance: makeInstance({ isCancelled: true }) });
      expect(wrapper.find('.cancelled-badge').exists()).toBe(true);
      wrapper.unmount();
    });

    it('does not render the cancelled badge when instance.isCancelled is false', () => {
      const wrapper = mountBody({ instance: makeInstance({ isCancelled: false }) });
      expect(wrapper.find('.cancelled-badge').exists()).toBe(false);
      wrapper.unmount();
    });

    it('renders the source-calendar pill when sourceCalendar is present', () => {
      const wrapper = mountBody({
        instance: makeInstance({
          sourceCalendar: {
            urlName: 'remote_cal',
            host: 'remote.example',
            url: 'https://remote.example/view/remote_cal',
          },
        }),
      });
      const pill = wrapper.find('.source-calendar-pill');
      expect(pill.exists()).toBe(true);
      expect(pill.text()).toBe('remote_cal@remote.example');
      expect(pill.attributes('target')).toBe('_blank');
      expect(pill.attributes('rel')).toBe('noopener noreferrer');
      wrapper.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // Place + Space layered display
  // -------------------------------------------------------------------------
  describe('Place + Space layered display', () => {
    describe('location header line', () => {
      it('renders Place name alone when no Space is set', () => {
        const wrapper = mountBody({
          instance: makeInstance({
            location: makePlace({ name: 'Convention Center' }),
          }),
        });
        const nameEl = wrapper.find('.location-name');
        expect(nameEl.exists()).toBe(true);
        expect(nameEl.text()).toBe('Convention Center');
        // Em-dash separator only present when Space is set
        expect(nameEl.text()).not.toContain(' — ');
        wrapper.unmount();
      });

      it('renders "Place — Space" when a Space is set', () => {
        const wrapper = mountBody({
          instance: makeInstance({
            location: makePlace({ name: 'Convention Center' }),
            space: makeSpace({ name: 'Pacific Room' }),
          }),
        });
        const nameEl = wrapper.find('.location-name');
        expect(nameEl.exists()).toBe(true);
        expect(nameEl.text()).toBe('Convention Center — Pacific Room');
        wrapper.unmount();
      });
    });

    describe('layered accessibility subsections', () => {
      it('hides the whole accessibility container when event, venue, and space are all empty', () => {
        const wrapper = mountBody({
          instance: makeInstance({
            accessibilityInfo: '',
            location: makePlace({ accessibilityInfo: {} }),
            space: makeSpace({ accessibilityInfo: {} }),
          }),
        });
        expect(wrapper.find('.accessibility-card').exists()).toBe(false);
        wrapper.unmount();
      });

      it('renders only the event subsection when only the event has accessibility info', () => {
        const wrapper = mountBody({
          instance: makeInstance({
            accessibilityInfo: 'ASL interpretation provided',
            location: makePlace({ accessibilityInfo: {} }),
            space: makeSpace({ accessibilityInfo: {} }),
          }),
        });
        const card = wrapper.find('.accessibility-card');
        expect(card.exists()).toBe(true);
        expect(wrapper.find('.accessibility-section--event').exists()).toBe(true);
        expect(wrapper.find('.accessibility-section--venue').exists()).toBe(false);
        expect(wrapper.find('.accessibility-section--space').exists()).toBe(false);
        expect(card.text()).toContain('Event accessibility');
        expect(card.text()).toContain('ASL interpretation provided');
        wrapper.unmount();
      });

      it('renders the event, venue, and space subsections when all three are populated', () => {
        const wrapper = mountBody({
          instance: makeInstance({
            accessibilityInfo: 'ASL interpretation provided',
            location: makePlace({
              accessibilityInfo: { en: 'Wheelchair ramp at entrance' },
            }),
            space: makeSpace({
              accessibilityInfo: { en: 'Hearing loop, 3rd floor' },
            }),
          }),
        });
        const card = wrapper.find('.accessibility-card');
        expect(card.exists()).toBe(true);
        expect(wrapper.find('.accessibility-section--event').exists()).toBe(true);
        expect(wrapper.find('.accessibility-section--venue').exists()).toBe(true);
        expect(wrapper.find('.accessibility-section--space').exists()).toBe(true);
        expect(card.text()).toContain('Event accessibility');
        expect(card.text()).toContain('ASL interpretation provided');
        expect(card.text()).toContain('Venue accessibility');
        expect(card.text()).toContain('Wheelchair ramp at entrance');
        expect(card.text()).toContain('Space accessibility');
        expect(card.text()).toContain('Hearing loop, 3rd floor');
        wrapper.unmount();
      });

      it('renders only the venue subsection when only Place has accessibility info', () => {
        const wrapper = mountBody({
          instance: makeInstance({
            location: makePlace({
              accessibilityInfo: { en: 'Wheelchair ramp at entrance' },
            }),
            space: makeSpace({ accessibilityInfo: {} }),
          }),
        });
        const card = wrapper.find('.accessibility-card');
        expect(card.exists()).toBe(true);
        expect(wrapper.find('.accessibility-section--venue').exists()).toBe(true);
        expect(wrapper.find('.accessibility-section--space').exists()).toBe(false);
        expect(card.text()).toContain('Venue accessibility');
        expect(card.text()).toContain('Wheelchair ramp at entrance');
        expect(card.text()).not.toContain('Space accessibility');
        wrapper.unmount();
      });

      it('renders only the space subsection when only Space has accessibility info', () => {
        const wrapper = mountBody({
          instance: makeInstance({
            location: makePlace({ accessibilityInfo: {} }),
            space: makeSpace({
              accessibilityInfo: { en: 'Hearing loop, 3rd floor' },
            }),
          }),
        });
        const card = wrapper.find('.accessibility-card');
        expect(card.exists()).toBe(true);
        expect(wrapper.find('.accessibility-section--venue').exists()).toBe(false);
        expect(wrapper.find('.accessibility-section--space').exists()).toBe(true);
        expect(card.text()).toContain('Space accessibility');
        expect(card.text()).toContain('Hearing loop, 3rd floor');
        expect(card.text()).not.toContain('Venue accessibility');
        wrapper.unmount();
      });

      it('renders both venue and space subsections when both are populated', () => {
        const wrapper = mountBody({
          instance: makeInstance({
            location: makePlace({
              accessibilityInfo: { en: 'Wheelchair ramp at entrance' },
            }),
            space: makeSpace({
              accessibilityInfo: { en: 'Hearing loop, 3rd floor' },
            }),
          }),
        });
        const card = wrapper.find('.accessibility-card');
        expect(card.exists()).toBe(true);
        expect(wrapper.find('.accessibility-section--venue').exists()).toBe(true);
        expect(wrapper.find('.accessibility-section--space').exists()).toBe(true);
        expect(card.text()).toContain('Venue accessibility');
        expect(card.text()).toContain('Wheelchair ramp at entrance');
        expect(card.text()).toContain('Space accessibility');
        expect(card.text()).toContain('Hearing loop, 3rd floor');
        wrapper.unmount();
      });

      it('hides the space subsection when no Space is set, even if Place has info', () => {
        const wrapper = mountBody({
          instance: makeInstance({
            location: makePlace({
              accessibilityInfo: { en: 'Wheelchair ramp at entrance' },
            }),
            // no space
          }),
        });
        expect(wrapper.find('.accessibility-card').exists()).toBe(true);
        expect(wrapper.find('.accessibility-section--venue').exists()).toBe(true);
        expect(wrapper.find('.accessibility-section--space').exists()).toBe(false);
        wrapper.unmount();
      });
    });
  });

  describe('categoryHrefBuilder seam', () => {
    it('renders categories as <a> when builder is provided, with builder(cat) as href', () => {
      const cats = [makeCategory('cat-1', 'Music')];
      const wrapper = mountBody({
        instance: makeInstance({ categories: cats }),
        categoryHrefBuilder: (cat) => `/view/test_calendar?category=${cat.id}`,
      });
      const badge = wrapper.find('.event-category-badge');
      expect(badge.exists()).toBe(true);
      expect(badge.element.tagName).toBe('A');
      expect(badge.attributes('href')).toBe('/view/test_calendar?category=cat-1');
      wrapper.unmount();
    });

    it('renders categories as <span> when builder is undefined', () => {
      const cats = [makeCategory('cat-1', 'Music')];
      const wrapper = mountBody({ instance: makeInstance({ categories: cats }) });
      const badge = wrapper.find('.event-category-badge');
      expect(badge.exists()).toBe(true);
      expect(badge.element.tagName).toBe('SPAN');
      expect(badge.attributes('href')).toBeUndefined();
      wrapper.unmount();
    });
  });

  describe('external URL CTA security guards', () => {
    // Cases moved from src/widget/test/event-detail-overlay.test.ts.

    it('should render CTA anchor when externalUrl and urlPrompt are both valid', () => {
      const wrapper = mountBody({
        instance: makeInstance({
          externalUrl: 'https://tickets.example.com/show/123',
          urlPrompt: 'tickets',
        }),
      });
      const cta = wrapper.find('.external-link-button');
      expect(cta.exists()).toBe(true);
      expect(cta.attributes('href')).toBe('https://tickets.example.com/show/123');
      wrapper.unmount();
    });

    it('should use target="_blank" and rel="noopener noreferrer" on the CTA anchor', () => {
      const wrapper = mountBody({
        instance: makeInstance({
          externalUrl: 'https://rsvp.example.com/party',
          urlPrompt: 'rsvp',
        }),
      });
      const cta = wrapper.find('.external-link-button');
      expect(cta.exists()).toBe(true);
      expect(cta.attributes('target')).toBe('_blank');
      expect(cta.attributes('rel')).toBe('noopener noreferrer');
      wrapper.unmount();
    });

    it('should display the translated label from system:url_prompt.<prompt>', () => {
      const wrapper = mountBody({
        instance: makeInstance({
          externalUrl: 'https://example.com/info',
          urlPrompt: 'more_info',
        }),
      });
      const cta = wrapper.find('.external-link-button');
      expect(cta.exists()).toBe(true);
      expect(cta.text()).toContain('More Information');
      wrapper.unmount();
    });

    it('should NOT render the CTA when externalUrl is null', () => {
      const wrapper = mountBody({
        instance: makeInstance({ externalUrl: null, urlPrompt: 'tickets' }),
      });
      expect(wrapper.find('.external-link-button').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should NOT render the CTA when urlPrompt is null', () => {
      const wrapper = mountBody({
        instance: makeInstance({ externalUrl: 'https://example.com', urlPrompt: null }),
      });
      expect(wrapper.find('.external-link-button').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should NOT render the CTA for javascript: URLs (defense-in-depth)', () => {
      const wrapper = mountBody({
        instance: makeInstance({
          externalUrl: 'javascript:alert(1)',
          urlPrompt: 'tickets',
        }),
      });
      expect(wrapper.find('.external-link-button').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should NOT render the CTA for unknown urlPrompt values', () => {
      const wrapper = mountBody({
        instance: makeInstance({
          externalUrl: 'https://example.com',
          urlPrompt: 'hack',
        }),
      });
      expect(wrapper.find('.external-link-button').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should NOT render the CTA for malformed URLs', () => {
      const wrapper = mountBody({
        instance: makeInstance({
          externalUrl: 'not a url at all',
          urlPrompt: 'tickets',
        }),
      });
      expect(wrapper.find('.external-link-button').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should NOT render the CTA for data: URLs (defense-in-depth)', () => {
      const wrapper = mountBody({
        instance: makeInstance({
          externalUrl: 'data:text/html,<script>alert(1)</script>',
          urlPrompt: 'tickets',
        }),
      });
      expect(wrapper.find('.external-link-button').exists()).toBe(false);
      wrapper.unmount();
    });
  });
});
