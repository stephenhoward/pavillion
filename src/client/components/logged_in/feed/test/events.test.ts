import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import sinon from 'sinon';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import FollowedEventsView from '../events.vue';
import { useFeedStore } from '@/client/stores/feedStore';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';

describe('FollowedEventsView', () => {
  let pinia: ReturnType<typeof createPinia>;
  let sandbox: sinon.SinonSandbox;

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);
    sandbox = sinon.createSandbox();

    // Setup calendar store with a test calendar
    const calendarStore = useCalendarStore();
    const calendar = new Calendar('cal-123', 'test-calendar');
    calendar.addContent({ language: 'en', title: 'Test Calendar' });
    calendarStore.setCalendars([calendar]);
    calendarStore.setSelectedCalendar('cal-123');

    // Initialize i18next for testing
    await i18next.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: {
          feed: {
            events: {
              name: 'Events',
              description: 'Events from calendars you follow',
              no_events: 'No events',
              follow_button: 'Follow a Calendar',
              untitled_event: 'Untitled Event',
            },
          },
        },
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('shows empty state with "Follow a Calendar" button when no events', () => {
    const feedStore = useFeedStore();
    feedStore.events = [];

    const wrapper = mount(FollowedEventsView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    expect(wrapper.text()).toContain('No events');
    const button = wrapper.find('button.primary');
    expect(button.exists()).toBe(true);
    expect(button.text()).toContain('Follow a Calendar');
  });

  it('renders event list with correct repost status indicators', () => {
    const feedStore = useFeedStore();

    // Create test events with different repost statuses
    const event1 = CalendarEvent.fromObject({
      id: 'event-1',
      calendarId: 'remote-cal-1',
      date: '2025-12-27',
      content: {
        en: {
          language: 'en',
          name: 'Test Event 1',
          description: 'Description 1',
        },
      },
    });
    const event2 = CalendarEvent.fromObject({
      id: 'event-2',
      calendarId: 'remote-cal-2',
      date: '2025-12-28',
      content: {
        en: {
          language: 'en',
          name: 'Test Event 2',
          description: 'Description 2',
        },
      },
    });
    const event3 = CalendarEvent.fromObject({
      id: 'event-3',
      calendarId: 'remote-cal-3',
      date: '2025-12-29',
      content: {
        en: {
          language: 'en',
          name: 'Test Event 3',
          description: 'Description 3',
        },
      },
    });

    feedStore.events = [
      Object.assign(event1, { repostStatus: 'none' as const }),
      Object.assign(event2, { repostStatus: 'manual' as const }),
      Object.assign(event3, { repostStatus: 'auto' as const }),
    ];

    const wrapper = mount(FollowedEventsView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    const eventItems = wrapper.findAll('[data-testid="event-item"]');
    expect(eventItems).toHaveLength(3);

    // First event should have Repost button
    expect(eventItems[0].text()).toContain('Test Event 1');
    expect(eventItems[0].find('button[data-testid="repost-button"]').exists()).toBe(true);

    // Second event should show Reposted label
    expect(eventItems[1].text()).toContain('Test Event 2');
    expect(eventItems[1].find('[data-testid="reposted-label"]').exists()).toBe(true);

    // Third event should show Auto-posted label
    expect(eventItems[2].text()).toContain('Test Event 3');
    expect(eventItems[2].find('[data-testid="auto-posted-label"]').exists()).toBe(true);
  });

  it('triggers store repostEvent action when repost button clicked', async () => {
    const feedStore = useFeedStore();

    const event = CalendarEvent.fromObject({
      id: 'event-1',
      calendarId: 'remote-cal',
      date: '2025-12-27',
      content: {
        en: {
          language: 'en',
          name: 'Test Event',
          description: 'Description',
        },
      },
    });

    feedStore.events = [Object.assign(event, { repostStatus: 'none' as const })];

    const repostStub = sandbox.stub(feedStore, 'repostEvent').resolves();

    const wrapper = mount(FollowedEventsView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    const repostButton = wrapper.find('button[data-testid="repost-button"]');
    await repostButton.trigger('click');

    expect(repostStub.calledOnce).toBe(true);
    expect(repostStub.calledWith('event-1')).toBe(true);
  });

  it('triggers store unrepostEvent action when reposted label clicked', async () => {
    const feedStore = useFeedStore();

    const event = CalendarEvent.fromObject({
      id: 'event-1',
      calendarId: 'remote-cal',
      date: '2025-12-27',
      content: {
        en: {
          language: 'en',
          name: 'Test Event',
          description: 'Description',
        },
      },
    });

    feedStore.events = [Object.assign(event, { repostStatus: 'manual' as const })];

    const unrepostStub = sandbox.stub(feedStore, 'unrepostEvent').resolves();

    const wrapper = mount(FollowedEventsView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    const repostedLabel = wrapper.find('[data-testid="reposted-label"]');
    await repostedLabel.trigger('click');

    expect(unrepostStub.calledOnce).toBe(true);
    expect(unrepostStub.calledWith('event-1')).toBe(true);
  });

  it('loads more events on scroll when intersection observer triggers', async () => {
    const feedStore = useFeedStore();
    feedStore.eventsHasMore = true;

    const event = CalendarEvent.fromObject({
      id: 'event-1',
      calendarId: 'remote-cal',
      date: '2025-12-27',
      content: {
        en: {
          language: 'en',
          name: 'Test Event',
          description: 'Description',
        },
      },
    });

    feedStore.events = [Object.assign(event, { repostStatus: 'none' as const })];

    const loadFeedStub = sandbox.stub(feedStore, 'loadFeed').resolves();

    // Mock IntersectionObserver
    const observeStub = sandbox.stub();
    const unobserveStub = sandbox.stub();
    const disconnectStub = sandbox.stub();

    global.IntersectionObserver = class IntersectionObserver {
      observe = observeStub;
      unobserve = unobserveStub;
      disconnect = disconnectStub;

      constructor(callback: IntersectionObserverCallback) {
        // Simulate intersection after mount
        setTimeout(() => {
          callback([{ isIntersecting: true }] as any, this as any);
        }, 10);
      }
    } as any;

    const wrapper = mount(FollowedEventsView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    // Wait for intersection observer callback
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(loadFeedStub.calledOnce).toBe(true);
    expect(loadFeedStub.calledWith(true)).toBe(true);
  });
});
