/**
 * Tests for widget-container.vue's mount ordering.
 *
 * `publicCalendarStore.setCurrentCalendar()` resets every filter (including
 * the date range) the first time it sees a calendar. SearchFilterPublic reads
 * the date range from the URL when it mounts. If the reset lands after that
 * read, the URL's range is wiped and the default range is fetched instead —
 * which is what a deep link, an iframe reload, or history back to the list
 * used to hit. These tests mount the real SearchFilterPublic to prove the
 * URL range survives the container's mount.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
import { createRouter, createMemoryHistory, Router } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';

import WidgetContainer from '../widget-container.vue';
import CalendarService from '@/site/service/calendar';
import ModelService from '@/client/service/models';
import ListResult from '@/client/service/list-result';
import { Calendar } from '@/common/model/calendar';
import { usePublicCalendarStore } from '@/site/stores/publicCalendarStore';
import { useWidgetStore } from '../../stores/widgetStore';

vi.mock('@/site/service/calendar');
vi.mock('@/client/service/models');

const LIST_PATH = '/widget/test_calendar?startDate=2026-11-01&endDate=2026-11-30';

async function mountContainerAt(path: string): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/widget/:urlName', name: 'widget-calendar', component: WidgetContainer },
    ],
  });
  await router.push(path);
  await router.isReady();

  const wrapper = mount(WidgetContainer, {
    global: {
      plugins: [router, [I18NextVue, { i18next }]],
      provide: { site_config: { settings: () => ({}) } },
      stubs: {
        WeekView: true,
        MonthView: true,
        ListView: true,
        NotFound: true,
        CategoryPillSelector: true,
      },
    },
  });
  await flushPromises();
  return { wrapper, router };
}

function eventRequestUrls(): string[] {
  return vi.mocked(ModelService.listModels).mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.includes('/events'));
}

beforeAll(async () => {
  if (!i18next.isInitialized) {
    await i18next.init({ lng: 'en', resources: { en: { system: {} } } });
  }
});

describe('widget-container mount ordering', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    setActivePinia(createPinia());
    useWidgetStore().viewMode = 'list';
    vi.mocked(CalendarService.prototype.getCalendarByUrlName)
      .mockResolvedValue(new Calendar('calendar-1', 'test_calendar'));
    vi.mocked(ModelService.listModels).mockResolvedValue(ListResult.fromArray([]));
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.clearAllMocks();
  });

  it('keeps the URL date range in the store when the widget first loads a calendar', async () => {
    const mounted = await mountContainerAt(LIST_PATH);
    wrapper = mounted.wrapper;

    const store = usePublicCalendarStore();
    expect(store.currentCalendarUrlName).toBe('test_calendar');
    expect(store.startDate).toBe('2026-11-01');
    expect(store.endDate).toBe('2026-11-30');
  });

  it('leaves the date range in the URL rather than stripping it on load', async () => {
    const mounted = await mountContainerAt(LIST_PATH);
    wrapper = mounted.wrapper;

    expect(mounted.router.currentRoute.value.query).toMatchObject({
      startDate: '2026-11-01',
      endDate: '2026-11-30',
    });
  });

  it('fetches events for the URL date range, not the default range', async () => {
    const mounted = await mountContainerAt(LIST_PATH);
    wrapper = mounted.wrapper;

    const urls = eventRequestUrls();
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toContain('startDate=2026-11-01');
      expect(url).toContain('endDate=2026-11-30');
    }
  });
});
