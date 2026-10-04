import { describe, it, expect, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import { DateTime } from 'luxon';
import ListView from '../list-view.vue';
import EventCard from '@/site/components/event-card.vue';
import { usePublicCalendarStore } from '@/site/stores/publicCalendarStore';
import { INSTANCE_SLUG_PATTERN } from '@/common/utils/instance-slug';
import { useWidgetStore } from '../../stores/widgetStore';

// Initialize i18next for tests
i18next.init({
  lng: 'en',
  resources: {
    en: {
      system: {
        loading_events: 'Loading events...',
        no_events_with_filters: 'No events match your filters',
        no_events_available: 'No events available',
      },
    },
  },
});

// Create a mock router
const createMockRouter = () => {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/widget/:urlName', name: 'widget-calendar', component: { template: '<div></div>' } },
      { path: `/widget/:urlName/events/:eventId/:startTime(${INSTANCE_SLUG_PATTERN})?`, name: 'widget-event-detail', component: { template: '<div></div>' } },
    ],
  });
};

describe('Widget ListView', () => {
  let router: any;

  beforeEach(() => {
    setActivePinia(createPinia());
    router = createMockRouter();
  });
  describe('rendering', () => {
    // Build a minimal instance fixture compatible with both the day-grouping
    // getter (which calls instance.start.toLocal().toISODate()) and the
    // EventCard detailHref builder (which calls formatInstanceSlug, hitting
    // start.toUTC().toFormat(...)).
    const buildListInstance = (
      id: string,
      eventId: string,
      start: DateTime,
      dayKey: string,
    ) => ({
      id,
      start: {
        toLocal: () => ({
          toISODate: () => dayKey,
          toLocaleString: () => '10:00 AM',
        }),
        toUTC: () => start.toUTC(),
        toFormat: (fmt: string) => start.toUTC().toFormat(fmt),
      },
      end: null,
      isCancelled: false,
      event: {
        id: eventId,
        content: () => ({ name: `Event ${eventId}`, description: '' }),
        hasContent: () => true,
        getLanguages: () => ['en'],
        media: null,
        categories: [],
        location: null,
        isRecurring: false,
        repostStatus: 'none',
        sourceCalendar: null,
      },
    });

    it('adapts calendar.vue pattern for widget by rendering an EventCard per instance', async () => {
      const publicStore = usePublicCalendarStore();
      const widgetStore = useWidgetStore();
      widgetStore.setCalendarUrlName('mycal');

      const start = DateTime.fromISO('2026-01-06T18:00:00.000Z', { zone: 'utc' });
      publicStore.allEvents = [
        buildListInstance('1', 'e1', start, '2026-01-06'),
      ] as any;

      const wrapper = mount(ListView, {
        global: {
          plugins: [[I18NextVue, { i18next }], router],
        },
      });

      // Should have a day section
      expect(wrapper.find('.day').exists()).toBe(true);

      // Should render exactly one EventCard for the single instance
      const eventCards = wrapper.findAllComponents(EventCard);
      expect(eventCards.length).toBe(1);
    });

    it('renders distinct EventCards with distinct detailHref props for two instances', async () => {
      const publicStore = usePublicCalendarStore();
      const widgetStore = useWidgetStore();
      widgetStore.setCalendarUrlName('mycal');

      const start1 = DateTime.fromISO('2026-01-06T18:00:00.000Z', { zone: 'utc' });
      const start2 = DateTime.fromISO('2026-01-07T19:00:00.000Z', { zone: 'utc' });
      publicStore.allEvents = [
        buildListInstance('1', 'e1', start1, '2026-01-06'),
        buildListInstance('2', 'e2', start2, '2026-01-07'),
      ] as any;

      const wrapper = mount(ListView, {
        global: {
          plugins: [[I18NextVue, { i18next }], router],
        },
      });

      const eventCards = wrapper.findAllComponents(EventCard);
      expect(eventCards.length).toBe(2);

      const href1 = eventCards[0].props('detailHref') as string;
      const href2 = eventCards[1].props('detailHref') as string;
      expect(href1).toBeTruthy();
      expect(href2).toBeTruthy();
      expect(href1).toContain('e1');
      expect(href2).toContain('e2');
      expect(href1).not.toBe(href2);
    });
  });

  describe('openEvent slug navigation', () => {
    const today = DateTime.now().toISODate()!;
    // A known instant so we can assert the exact slug. 2026-05-08 18:00 UTC.
    const fixedStart = DateTime.fromISO('2026-05-08T18:00:00.000Z', { zone: 'utc' });
    const fixedSlug = '20260508-1800';

    const buildInstance = (start: DateTime) => ({
      id: 'inst-1',
      start: {
        // toLocal used by component grouping for dayKey
        toLocal: () => ({
          toISODate: () => today,
          toLocaleString: () => '10:00 AM',
        }),
        // toUTC used by formatInstanceSlug
        toUTC: () => start.toUTC(),
        // Luxon passthrough fields needed by formatInstanceSlug
        toFormat: (fmt: string) => start.toUTC().toFormat(fmt),
      },
      end: null,
      isCancelled: false,
      event: {
        id: 'evt-1',
        content: () => ({ name: 'Test Event', description: '' }),
        // EventCard uses useLocalizedContent → hasContent / getLanguages
        hasContent: () => true,
        getLanguages: () => ['en'],
        media: null,
        categories: [],
        location: null,
        isRecurring: false,
        repostStatus: 'none',
        sourceCalendar: null,
      },
    });

    it('ListView EventCard detailHref includes the startTime slug', async () => {
      const publicStore = usePublicCalendarStore();
      const widgetStore = useWidgetStore();
      widgetStore.setCalendarUrlName('mycal');

      publicStore.allEvents = [buildInstance(fixedStart)] as any;

      const wrapper = mount(ListView, {
        global: {
          plugins: [[I18NextVue, { i18next }], router],
        },
      });

      const cards = wrapper.findAllComponents(EventCard);
      expect(cards.length).toBe(1);
      const detailHref = cards[0].props('detailHref') as string;
      expect(detailHref).toContain(fixedSlug);
      expect(detailHref).toContain('mycal');
      expect(detailHref).toContain('evt-1');
    });

    it('ListView EventCard title click navigates in the widget router, not the document', async () => {
      const publicStore = usePublicCalendarStore();
      const widgetStore = useWidgetStore();
      widgetStore.setCalendarUrlName('mycal');

      publicStore.allEvents = [buildInstance(fixedStart)] as any;

      await router.push('/widget/mycal');
      await router.isReady();

      const wrapper = mount(ListView, {
        global: {
          plugins: [[I18NextVue, { i18next }], router],
        },
      });

      const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      wrapper.find('.event-title-link').element.dispatchEvent(click);
      await flushPromises();

      expect(click.defaultPrevented).toBe(true);
      expect(router.currentRoute.value.name).toBe('widget-event-detail');
      expect(router.currentRoute.value.params).toEqual({
        urlName: 'mycal',
        eventId: 'evt-1',
        startTime: fixedSlug,
      });
    });
  });
});
