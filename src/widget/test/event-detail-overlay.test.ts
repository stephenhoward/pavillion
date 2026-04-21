/**
 * Tests for the widget's event detail overlay external-URL CTA button.
 *
 * Validates defense-in-depth computed guards and rendering rules ported
 * from the public-site event-instance implementation (pv-itux.5.1):
 *   - javascript: URLs are blocked before reaching the DOM
 *   - unknown urlPrompt values are blocked before reaching the DOM
 *   - valid (http/https) URL + known prompt → CTA anchor rendered with
 *     target="_blank" rel="noopener noreferrer" and translated label
 *   - null externalUrl OR null urlPrompt → CTA is omitted
 *   - malformed URL strings → CTA is omitted
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { createPinia } from 'pinia';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';

// ---------------------------------------------------------------------------
// Mocks — declared before component import
// ---------------------------------------------------------------------------

// Mutable externalUrl / urlPrompt so tests can inject CTA data
let mockExternalUrl: string | null = null;
let mockUrlPrompt: string | null = null;

vi.mock('@/site/service/calendar', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      getCalendarByUrlName: vi.fn().mockResolvedValue({
        urlName: 'test_calendar',
        content: (_lang: string) => ({ name: 'Test Calendar', description: '' }),
        hasContent: (_lang: string) => true,
        getLanguages: () => ['en'],
      }),
      loadCalendarEvents: vi.fn().mockImplementation(() => {
        const localized = {
          setLocale: () => ({
            toLocaleString: () => 'March 1, 2026',
          }),
          toLocaleString: () => 'March 1, 2026, 10:00 AM',
        };
        return Promise.resolve([
          {
            id: 'inst-1',
            start: {
              toISO: () => '2026-03-01T10:00:00.000Z',
              toLocal: () => localized,
              hasSame: () => true,
            },
            end: null,
            event: {
              id: 'evt-1',
              content: (_lang: string) => ({ name: 'Test Event', description: 'Description' }),
              hasContent: (_lang: string) => true,
              getLanguages: () => ['en'],
              media: null,
              mediaFocalPointX: 0.5,
              mediaFocalPointY: 0.5,
              mediaZoom: 1.0,
              categories: [],
              recurrenceSummary: null,
              location: null,
              sourceCalendar: null,
              externalUrl: mockExternalUrl,
              urlPrompt: mockUrlPrompt,
            },
          },
        ]);
      }),
      loadEventInstance: vi.fn().mockImplementation(() => {
        const localized = {
          setLocale: () => ({
            toLocaleString: () => 'March 1, 2026',
          }),
          toLocaleString: () => 'March 1, 2026, 10:00 AM',
        };
        return Promise.resolve({
          id: 'inst-1',
          start: {
            toISO: () => '2026-03-01T10:00:00.000Z',
            toLocal: () => localized,
            hasSame: () => true,
          },
          end: null,
          event: {
            id: 'evt-1',
            content: (_lang: string) => ({ name: 'Test Event', description: 'Description' }),
            hasContent: (_lang: string) => true,
            getLanguages: () => ['en'],
            media: null,
            mediaFocalPointX: 0.5,
            mediaFocalPointY: 0.5,
            mediaZoom: 1.0,
            categories: [],
            recurrenceSummary: null,
            location: null,
            sourceCalendar: null,
            externalUrl: mockExternalUrl,
            urlPrompt: mockUrlPrompt,
          },
        });
      }),
    })),
  };
});

vi.mock('@/site/components/not-found.vue', () => ({
  default: { template: '<div class="not-found-stub"></div>' },
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
import EventDetailOverlay from '@/widget/components/event-detail-overlay.vue';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const routes: RouteRecordRaw[] = [
  {
    path: '/widget/:urlName/events/:eventId',
    component: EventDetailOverlay,
    name: 'widget-event',
  },
  {
    path: '/widget/:urlName',
    component: { template: '<div />' },
    name: 'widget-calendar',
  },
];

async function buildRouter(initialPath: string): Promise<Router> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  await router.push(initialPath);
  await router.isReady();
  return router;
}

async function mountOverlay(initialPath: string): Promise<VueWrapper> {
  const router = await buildRouter(initialPath);
  const pinia = createPinia();

  const wrapper = mount(EventDetailOverlay, {
    global: {
      plugins: [
        router,
        [I18NextVue, { i18next }],
        pinia,
      ],
    },
  });

  await flushPromises();
  return wrapper;
}

// ---------------------------------------------------------------------------
// i18next initialisation
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const resources = {
    back: 'Back',
    back_to_calendar: 'Back to {{name}}',
    loading_event: 'Loading event...',
    url_prompt: {
      tickets: 'Tickets',
      rsvp: 'RSVP',
      more_info: 'More Information',
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

describe('widget event-detail-overlay external URL CTA button', () => {
  beforeEach(() => {
    mockExternalUrl = null;
    mockUrlPrompt = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should render CTA anchor when externalUrl and urlPrompt are both valid', async () => {
    mockExternalUrl = 'https://tickets.example.com/show/123';
    mockUrlPrompt = 'tickets';

    const wrapper = await mountOverlay('/widget/test_calendar/events/evt-1');

    const cta = wrapper.find('.external-link-button');
    expect(cta.exists()).toBe(true);
    expect(cta.attributes('href')).toBe('https://tickets.example.com/show/123');
    wrapper.unmount();
  });

  it('should use target="_blank" and rel="noopener noreferrer" on the CTA anchor', async () => {
    mockExternalUrl = 'https://rsvp.example.com/party';
    mockUrlPrompt = 'rsvp';

    const wrapper = await mountOverlay('/widget/test_calendar/events/evt-1');

    const cta = wrapper.find('.external-link-button');
    expect(cta.exists()).toBe(true);
    expect(cta.attributes('target')).toBe('_blank');
    expect(cta.attributes('rel')).toBe('noopener noreferrer');
    wrapper.unmount();
  });

  it('should display the translated label from system:url_prompt.<prompt>', async () => {
    mockExternalUrl = 'https://example.com/info';
    mockUrlPrompt = 'more_info';

    const wrapper = await mountOverlay('/widget/test_calendar/events/evt-1');

    const cta = wrapper.find('.external-link-button');
    expect(cta.exists()).toBe(true);
    expect(cta.text()).toBe('More Information');
    wrapper.unmount();
  });

  it('should NOT render the CTA when externalUrl is null', async () => {
    mockExternalUrl = null;
    mockUrlPrompt = 'tickets';

    const wrapper = await mountOverlay('/widget/test_calendar/events/evt-1');

    expect(wrapper.find('.external-link-button').exists()).toBe(false);
    wrapper.unmount();
  });

  it('should NOT render the CTA when urlPrompt is null', async () => {
    mockExternalUrl = 'https://example.com';
    mockUrlPrompt = null;

    const wrapper = await mountOverlay('/widget/test_calendar/events/evt-1');

    expect(wrapper.find('.external-link-button').exists()).toBe(false);
    wrapper.unmount();
  });

  it('should NOT render the CTA for javascript: URLs (defense-in-depth)', async () => {
    mockExternalUrl = 'javascript:alert(1)';
    mockUrlPrompt = 'tickets';

    const wrapper = await mountOverlay('/widget/test_calendar/events/evt-1');

    expect(wrapper.find('.external-link-button').exists()).toBe(false);
    wrapper.unmount();
  });

  it('should NOT render the CTA for unknown urlPrompt values', async () => {
    mockExternalUrl = 'https://example.com';
    mockUrlPrompt = 'hack';

    const wrapper = await mountOverlay('/widget/test_calendar/events/evt-1');

    expect(wrapper.find('.external-link-button').exists()).toBe(false);
    wrapper.unmount();
  });

  it('should NOT render the CTA for malformed URLs', async () => {
    mockExternalUrl = 'not a url at all';
    mockUrlPrompt = 'tickets';

    const wrapper = await mountOverlay('/widget/test_calendar/events/evt-1');

    expect(wrapper.find('.external-link-button').exists()).toBe(false);
    wrapper.unmount();
  });

  it('should NOT render the CTA for data: URLs (defense-in-depth)', async () => {
    mockExternalUrl = 'data:text/html,<script>alert(1)</script>';
    mockUrlPrompt = 'tickets';

    const wrapper = await mountOverlay('/widget/test_calendar/events/evt-1');

    expect(wrapper.find('.external-link-button').exists()).toBe(false);
    wrapper.unmount();
  });
});
