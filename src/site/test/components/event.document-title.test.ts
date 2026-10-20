/**
 * Tests for the event.vue component document.title behaviour.
 *
 * event.vue is the view for event links that carry no date slug. Validates:
 * - document.title is set to "Event Name | Pavillion" after loading event data.
 * - The title uses the event's localized name.
 * - document.title is left alone when the event is not found.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import { createMemoryHistory, createRouter, RouteRecordRaw } from 'vue-router';
import { createPinia } from 'pinia';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';

// ---------------------------------------------------------------------------
// Mocks — declared before component import
// ---------------------------------------------------------------------------

const mockCurrentLocale = ref('en');

vi.mock('@/common/ui/composables/useLocale', () => ({
  useLocale: () => ({
    currentLocale: mockCurrentLocale,
    switchLocale: vi.fn(),
    localizedPath: (path: string) => path,
  }),
}));

// Mutable event name so individual tests can control the event title
let mockEventName = 'Test Event';

// Null makes the service report the event as not found
let mockEventFound = true;

vi.mock('@/site/service/calendar', () => {
  return {
    default: vi.fn().mockImplementation(function () {
      return {
        getCalendarByUrlName: vi.fn().mockResolvedValue({
          urlName: 'test_calendar',
          content: (_lang: string) => ({ name: 'Test Calendar', description: '' }),
          hasContent: (_lang: string) => true,
          getLanguages: () => ['en'],
        }),
        loadEvent: vi.fn().mockImplementation(() =>
          Promise.resolve(mockEventFound
            ? {
              content: (_lang: string) => ({ name: mockEventName, description: 'Description here', accessibilityInfo: '', imageAlt: '' }),
              hasContent: (_lang: string) => true,
              getLanguages: () => ['en'],
              media: null,
              categories: [],
              location: null,
              space: null,
              series: null,
              schedules: [],
              sourceCalendar: null,
              externalUrl: null,
              urlPrompt: null,
            }
            : null),
        ),
      };
    }),
  };
});

vi.mock('@/site/components/report-event.vue', () => ({
  default: { template: '<div class="report-event-stub"></div>', props: ['eventId'] },
}));

vi.mock('@/site/components/not-found.vue', () => ({
  default: { template: '<div class="not-found-stub"></div>' },
}));

vi.mock('@/site/components/event-image.vue', () => ({
  default: { template: '<div class="event-image-stub"></div>', props: ['media', 'context', 'alt', 'focalPointX', 'focalPointY', 'zoom'] },
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------
import EventDetail from '@/site/components/event.vue';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const routes: RouteRecordRaw[] = [
  {
    path: '/:calendar/events/:event',
    component: EventDetail,
    name: 'event',
  },
];

async function mountEvent(initialPath: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  await router.push(initialPath);
  await router.isReady();

  const pinia = createPinia();

  const wrapper = mount(EventDetail, {
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
// Tests
// ---------------------------------------------------------------------------

describe('event.vue document.title', () => {
  beforeEach(() => {
    mockCurrentLocale.value = 'en';
    mockEventName = 'Test Event';
    mockEventFound = true;
    document.title = 'Pavillion'; // Reset to default before each test
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.title = 'Pavillion';
  });

  it('should set document.title to "Event Name | Pavillion" after loading event data', async () => {
    mockEventName = 'Summer Concert';

    const wrapper = await mountEvent('/test_calendar/events/event-1');

    expect(document.title).toBe('Summer Concert | Pavillion');
    wrapper.unmount();
  });

  it('should replace a title left by the previous page', async () => {
    mockEventName = 'Test Event';
    document.title = 'Test Calendar | Pavillion';

    const wrapper = await mountEvent('/test_calendar/events/event-1');

    expect(document.title).toBe('Test Event | Pavillion');
    wrapper.unmount();
  });

  it('should leave document.title alone when the event is not found', async () => {
    mockEventFound = false;

    const wrapper = await mountEvent('/test_calendar/events/missing');

    expect(wrapper.find('.not-found-stub').exists()).toBe(true);
    expect(document.title).toBe('Pavillion');
    wrapper.unmount();
  });
});
