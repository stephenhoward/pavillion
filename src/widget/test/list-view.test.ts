/**
 * Tests for the widget list view's event-detail links.
 *
 * The link's calendar comes from the route the list is rendered under, not
 * from the widget store: the router guard updates the store's calendar before
 * a cross-calendar navigation resolves, so during that window the store names
 * the calendar being navigated to while the list on screen still belongs to
 * the one being left.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import { DateTime } from 'luxon';

import { INSTANCE_SLUG_PATTERN } from '@/common/utils/instance-slug';
import ListView from '@/widget/components/list-view.vue';
import { useWidgetStore } from '@/widget/stores/widgetStore';
import { usePublicCalendarStore } from '@/site/stores/publicCalendarStore';

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/widget/:urlName', name: 'widget-calendar', component: ListView },
      { path: `/widget/:urlName/events/:eventId/:startTime(${INSTANCE_SLUG_PATTERN})?`, name: 'widget-event-detail', component: { template: '<div></div>' } },
    ],
  });
}

/**
 * A list instance satisfying day grouping, the site EventCard and
 * formatInstanceSlug.
 */
function buildInstance() {
  const start = DateTime.fromISO('2026-01-06T18:00:00.000Z', { zone: 'utc' });
  return {
    id: '1',
    start: {
      toLocal: () => ({ toISODate: () => '2026-01-06', toLocaleString: () => '10:00 AM' }),
      toUTC: () => start.toUTC(),
      toFormat: (fmt: string) => start.toUTC().toFormat(fmt),
    },
    end: null,
    isCancelled: false,
    event: {
      id: 'e1',
      content: () => ({ name: 'Test Event', description: '' }),
      hasContent: () => true,
      getLanguages: () => ['en'],
      media: null,
      categories: [],
      location: null,
      isRecurring: false,
      repostStatus: 'none',
      sourceCalendar: null,
    },
  };
}

beforeAll(async () => {
  if (!i18next.isInitialized) {
    await i18next.init({ lng: 'en', resources: { en: { system: {} } } });
  }
});

describe('widget list view detail links', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('links each event to detail under the calendar in the route, even when the store has moved on', async () => {
    const router = buildRouter();
    await router.push('/widget/shown_cal');
    usePublicCalendarStore().allEvents = [buildInstance()] as any;
    // As during a pending cross-calendar navigation: the guard has already
    // switched the store to the destination calendar.
    useWidgetStore().setCalendarUrlName('pending_cal');

    const wrapper = mount(ListView, {
      global: { plugins: [[I18NextVue, { i18next }], router] },
    });

    const href = wrapper.find('ul.day-events a[href*="/events/"]').attributes('href');
    expect(href).toMatch(/^\/widget\/shown_cal\/events\/e1\//);
    wrapper.unmount();
  });
});
