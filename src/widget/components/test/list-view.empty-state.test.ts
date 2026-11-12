/**
 * Tests for the widget list's empty state when the default date window holds
 * no events: it names the window searched and, when a later event exists,
 * links to that day inside the widget.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import ListView from '../list-view.vue';
import { usePublicCalendarStore } from '@/site/stores/publicCalendarStore';
import { INSTANCE_SLUG_PATTERN } from '@/common/utils/instance-slug';

i18next.init({
  lng: 'en',
  resources: {
    en: {
      system: {
        loading_events: 'Loading events...',
        no_events_with_filters: 'No events match your filters',
        no_events_available: 'No events available',
        no_events_in_default_range_hint: 'No events are scheduled between today and {{date}}.',
        next_event_link: 'See the next event, on {{date}}',
      },
    },
  },
});

const dayRoute = (isoDate: string) => ({
  name: 'widget-calendar',
  params: { urlName: 'mycal' },
  query: { startDate: isoDate, endDate: isoDate },
});

describe('Widget ListView empty state', () => {
  let router: any;
  let store: ReturnType<typeof usePublicCalendarStore>;

  beforeEach(async () => {
    setActivePinia(createPinia());
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/widget/:urlName', name: 'widget-calendar', component: { template: '<div></div>' } },
        { path: `/widget/:urlName/events/:eventId/:startTime(${INSTANCE_SLUG_PATTERN})?`, name: 'widget-event-detail', component: { template: '<div></div>' } },
      ],
    });
    await router.push('/widget/mycal?colorMode=dark');
    await router.isReady();
    store = usePublicCalendarStore();
    store.hasLoadedEvents = true;
    store.allEvents = [];
    store.loadNextEventDate = vi.fn().mockResolvedValue(undefined);
  });

  function mountList() {
    return mount(ListView, {
      props: { dayRoute },
      global: { plugins: [[I18NextVue, { i18next }], router] },
    });
  }

  it('names the window searched and looks up the next event', async () => {
    const wrapper = mountList();
    await flushPromises();

    expect(wrapper.text()).toContain('No events are scheduled between today and');
    expect(store.loadNextEventDate).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.next-event-link').exists()).toBe(false);
  });

  it('links to the next event inside the widget', async () => {
    store.nextEventDate = '2099-03-04';
    const wrapper = mountList();
    await flushPromises();

    const link = wrapper.get('.next-event-link');
    expect(link.text()).toContain('See the next event, on');
    expect(link.attributes('href')).toBe('/widget/mycal?startDate=2099-03-04&endDate=2099-03-04');
  });

  it('does not look up a next event when filters are active', async () => {
    store.searchQuery = 'jazz';
    const wrapper = mountList();
    await flushPromises();

    expect(store.hasActiveFilters).toBe(true);
    expect(wrapper.text()).toContain('No events match your filters');
    expect(store.loadNextEventDate).not.toHaveBeenCalled();
    expect(wrapper.find('.next-event-link').exists()).toBe(false);
  });
});
