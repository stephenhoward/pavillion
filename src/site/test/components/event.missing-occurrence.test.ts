/**
 * Tests for the undated event page's note about a linked date that has no
 * occurrence.
 *
 * event-instance.vue replaces such a dated link with this page and leaves
 * the linked start in router state as `missingOccurrence`. Validates:
 * - A valid slug renders the note in the viewer's zone and the page language.
 * - Absent or malformed state leaves the always-mounted status element empty.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createPinia } from 'pinia';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import { Settings } from 'luxon';

import enSystem from '@/site/locales/en/system.json';

vi.mock('@/common/ui/composables/useLocale', async () => {
  const { ref } = await import('vue');
  const currentLocale = ref('en');
  return {
    useLocale: () => ({
      currentLocale,
      switchLocale: vi.fn(),
      localizedPath: (path: string) => path,
    }),
  };
});

vi.mock('@/site/service/calendar', () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      getCalendarByUrlName: vi.fn().mockResolvedValue({
        urlName: 'test_calendar',
        content: () => ({ name: 'Test Calendar', description: '' }),
        hasContent: () => true,
        getLanguages: () => ['en'],
      }),
      loadEvent: vi.fn().mockResolvedValue({
        content: () => ({ name: 'Harvest Supper', description: '', accessibilityInfo: '', imageAlt: '' }),
        hasContent: () => true,
        getLanguages: () => ['en'],
        media: null,
        categories: [],
        location: null,
        space: null,
        series: null,
        sourceCalendar: null,
        externalUrl: null,
        urlPrompt: null,
      }),
    };
  }),
}));

vi.mock('@/site/components/report-event.vue', () => ({
  default: { template: '<div></div>', props: ['eventId'] },
}));

import EventDetail from '@/site/components/event.vue';

const EVENT_PATH = '/test_calendar/events/11111111-1111-4111-8111-111111111111';

async function openUndatedPage(state?: Record<string, unknown>) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:calendar/events/:event', component: EventDetail, name: 'event' }],
  });
  await router.push(state ? { path: EVENT_PATH, state } : EVENT_PATH);
  await router.isReady();
  const wrapper = mount(EventDetail, {
    global: { plugins: [router, [I18NextVue, { i18next }], createPinia()] },
  });
  await flushPromises();
  return wrapper;
}

describe('event.vue missing-occurrence note', () => {
  const originalZone = Settings.defaultZone;

  beforeAll(async () => {
    Settings.defaultZone = 'America/Chicago';
    if (!i18next.isInitialized) {
      await i18next.init({ lng: 'en', resources: { en: { system: enSystem } } });
    }
    else {
      i18next.addResourceBundle('en', 'system', enSystem, true, true);
    }
    await i18next.changeLanguage('en');
  });

  afterAll(() => {
    Settings.defaultZone = originalZone;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('names the linked date in the viewer\'s zone', async () => {
    const wrapper = await openUndatedPage({ missingOccurrence: '20261115-0000' });

    const note = wrapper.find('p[role="status"].event-note');
    // Intl may separate the time from AM/PM with a narrow no-break space.
    expect(note.text().replace(/\s/g, ' ')).toBe(
      'This link was for Nov 14, 2026, 6:00 PM. There is no occurrence of this event at that time.',
    );
  });

  it('leaves the status element empty without router state', async () => {
    const wrapper = await openUndatedPage();

    const note = wrapper.find('p[role="status"].event-note');
    expect(note.exists()).toBe(true);
    expect(note.text()).toBe('');
  });

  it('leaves the status element empty for a malformed slug', async () => {
    const wrapper = await openUndatedPage({ missingOccurrence: '20261340-9999' });

    expect(wrapper.find('p[role="status"].event-note').text()).toBe('');
  });

  it('leaves the status element empty for a non-string value', async () => {
    const wrapper = await openUndatedPage({ missingOccurrence: 20261115 });

    expect(wrapper.find('p[role="status"].event-note').text()).toBe('');
  });
});
