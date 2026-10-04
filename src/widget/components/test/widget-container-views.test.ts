/**
 * Tests for which calendar view widget-container.vue renders.
 *
 * The owner's configured view (`widgetStore.configuredView`) is the widget's
 * starting view, not a lock. Two admin-preview paths set it — the `?view=`
 * override the router guard reads once at load, and the same-origin
 * `pavillion:updateConfig` message — and both change what renders only until
 * the visitor has chosen a view of their own, which lives in the route query.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
import { createRouter, createMemoryHistory, Router } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';

import WidgetContainer from '../widget-container.vue';
import ListView from '../list-view.vue';
import { MonthView, WeekView } from '@/common/ui/calendar-views';
import CalendarService from '@/site/service/calendar';
import ModelService from '@/client/service/models';
import ListResult from '@/client/service/list-result';
import { Calendar } from '@/common/model/calendar';
import { useWidgetStore } from '../../stores/widgetStore';

vi.mock('@/site/service/calendar');
vi.mock('@/client/service/models');

const mounted: VueWrapper[] = [];

async function mountContainerAt(path: string): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/widget/:urlName', name: 'widget-calendar', component: WidgetContainer },
      { path: '/widget/:urlName/events/:eventId/:startTime?', name: 'widget-event-detail', component: { template: '<div></div>' } },
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
  mounted.push(wrapper);
  await flushPromises();
  return { wrapper, router };
}

function renderedView(wrapper: VueWrapper): string {
  if (wrapper.findComponent(WeekView).exists()) return 'week';
  if (wrapper.findComponent(MonthView).exists()) return 'month';
  if (wrapper.findComponent(ListView).exists()) return 'list';
  return 'none';
}

function postConfig(config: unknown) {
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'pavillion:updateConfig', config },
    origin: window.location.origin,
  }));
}

beforeAll(async () => {
  if (!i18next.isInitialized) {
    await i18next.init({ lng: 'en', resources: { en: { system: {} } } });
  }
});

beforeEach(() => {
  setActivePinia(createPinia());
  vi.mocked(CalendarService.prototype.getCalendarByUrlName)
    .mockResolvedValue(new Calendar('calendar-1', 'test_calendar'));
  vi.mocked(ModelService.listModels).mockResolvedValue(ListResult.fromArray([]));
});

afterEach(() => {
  while (mounted.length) {
    mounted.pop()!.unmount();
  }
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('widget-container configured view', () => {
  it('renders the configured view as the starting view', async () => {
    useWidgetStore().applyServerConfig({ view: 'month' });

    const { wrapper } = await mountContainerAt('/widget/test_calendar');

    expect(renderedView(wrapper)).toBe('month');
  });

  it('lets a ?view= override win over the server config for the initial render', async () => {
    // What the router guard does at load: server config, then the URL override.
    const store = useWidgetStore();
    store.applyServerConfig({ view: 'list' });
    store.parseConfig(new URLSearchParams('view=week'));

    const { wrapper } = await mountContainerAt('/widget/test_calendar?view=week');

    expect(renderedView(wrapper)).toBe('week');
  });

  it('changes the rendered view on pavillion:updateConfig without a reload', async () => {
    useWidgetStore().applyServerConfig({ view: 'list' });
    const { wrapper } = await mountContainerAt('/widget/test_calendar');
    expect(renderedView(wrapper)).toBe('list');

    postConfig({ view: 'month' });
    await flushPromises();

    expect(renderedView(wrapper)).toBe('month');
  });

  it('ignores an invalid view in pavillion:updateConfig', async () => {
    useWidgetStore().applyServerConfig({ view: 'month' });
    const { wrapper } = await mountContainerAt('/widget/test_calendar');

    postConfig({ view: 'agenda' });
    await flushPromises();

    expect(useWidgetStore().configuredView).toBe('month');
    expect(renderedView(wrapper)).toBe('month');
  });

  it('keeps the visitor\'s own view when pavillion:updateConfig changes the configured view', async () => {
    useWidgetStore().applyServerConfig({ view: 'month' });
    // The visitor switched away from the month default: their view is in the query.
    const { wrapper } = await mountContainerAt('/widget/test_calendar?view=list');
    expect(renderedView(wrapper)).toBe('list');

    postConfig({ view: 'week' });
    await flushPromises();

    expect(useWidgetStore().configuredView).toBe('week');
    expect(renderedView(wrapper)).toBe('list');
  });

  it('keeps the visitor\'s own view after they switch, whatever the configured view', async () => {
    useWidgetStore().applyServerConfig({ view: 'month' });
    const { wrapper, router } = await mountContainerAt('/widget/test_calendar');

    // Wide tier: the switcher offers list, week, month in that order.
    await wrapper.findAll('.ui-view-toolbar__view')[1].trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.view).toBe('week');
    expect(renderedView(wrapper)).toBe('week');

    postConfig({ view: 'list' });
    await flushPromises();

    expect(renderedView(wrapper)).toBe('week');
  });
});

describe('widget-container width', () => {
  it('shows the list and no switcher in a narrow frame, whatever the configured view', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 500, height: 600 } as DOMRect);
    useWidgetStore().applyServerConfig({ view: 'month' });

    const { wrapper, router } = await mountContainerAt('/widget/test_calendar');

    expect(renderedView(wrapper)).toBe('list');
    expect(wrapper.find('.ui-view-toolbar').exists()).toBe(false);
    expect(router.currentRoute.value.query.view).toBeUndefined();
  });

  it('shows the configured month and the switcher in a wide frame', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 1024, height: 600 } as DOMRect);
    useWidgetStore().applyServerConfig({ view: 'month' });

    const { wrapper } = await mountContainerAt('/widget/test_calendar');

    expect(renderedView(wrapper)).toBe('month');
    expect(wrapper.find('.ui-view-toolbar').exists()).toBe(true);
  });
});

describe('widget-container day links', () => {
  it('opens the list for a day even when the configured view is month', async () => {
    useWidgetStore().applyServerConfig({ view: 'month' });
    const { wrapper } = await mountContainerAt('/widget/test_calendar?lang=es&date=2026-03-10');

    const dayRoute = wrapper.findComponent(MonthView).props('dayRoute') as (iso: string) => any;
    const route = dayRoute('2026-03-12');

    expect(route).toEqual({
      name: 'widget-calendar',
      params: { urlName: 'test_calendar' },
      query: { lang: 'es', view: 'list', startDate: '2026-03-12', endDate: '2026-03-12' },
    });
  });
});
