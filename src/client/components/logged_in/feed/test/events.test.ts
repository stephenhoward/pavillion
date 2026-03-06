import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import sinon from 'sinon';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import FollowedEventsView from '../events.vue';
import { useFeedStore } from '@/client/stores/feedStore';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';

const mockEventsIsLoading = ref(false);
const mockLoadFeed = vi.fn();
const mockLoadMore = vi.fn();

vi.mock('@/client/composables/useFeedEvents', () => ({
  useFeedEvents: () => ({
    isLoading: mockEventsIsLoading,
    loadFeed: mockLoadFeed,
    loadMore: mockLoadMore,
  }),
}));

const mockRepostEvent = vi.fn();
const mockUnrepostEvent = vi.fn();
const mockConfirmRepost = vi.fn();

vi.mock('@/client/composables/useFeedRepost', () => ({
  useFeedRepost: () => ({
    repostEvent: mockRepostEvent,
    unrepostEvent: mockUnrepostEvent,
    confirmRepost: mockConfirmRepost,
  }),
  PendingRepost: {},
}));

vi.mock('@/client/composables/useToast', () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

describe('FollowedEventsView', () => {
  let pinia: ReturnType<typeof createPinia>;
  let sandbox: sinon.SinonSandbox;

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);
    sandbox = sinon.createSandbox();

    // Reset mocks
    mockEventsIsLoading.value = false;
    mockLoadFeed.mockReset();
    mockLoadMore.mockReset();
    mockRepostEvent.mockReset();
    mockUnrepostEvent.mockReset();
    mockConfirmRepost.mockReset();

    // Mock native dialog methods not implemented in happy-dom
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(() => {});
    vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(() => {});

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
              report_button: 'Report',
              report_aria_label: 'Report event: {{eventTitle}}',
            },
          },
        },
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
    vi.restoreAllMocks();
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

    // Every event item should have a report button with a contextual aria-label
    for (const [i, item] of eventItems.entries()) {
      const reportButton = item.find('button[data-testid="report-button"]');
      expect(reportButton.exists()).toBe(true);
      expect(reportButton.attributes('aria-label')).toContain(`Test Event ${i + 1}`);
    }
  });

  it('triggers repostEvent composable when repost button clicked', async () => {
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

    mockRepostEvent.mockResolvedValue(null);

    const wrapper = mount(FollowedEventsView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    const repostButton = wrapper.find('button[data-testid="repost-button"]');
    await repostButton.trigger('click');

    expect(mockRepostEvent).toHaveBeenCalledOnce();
    expect(mockRepostEvent).toHaveBeenCalledWith('event-1');
  });

  it('triggers unrepostEvent composable when reposted label clicked', async () => {
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

    mockUnrepostEvent.mockResolvedValue(undefined);

    const wrapper = mount(FollowedEventsView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    const repostedLabel = wrapper.find('[data-testid="reposted-label"]');
    await repostedLabel.trigger('click');

    expect(mockUnrepostEvent).toHaveBeenCalledOnce();
    expect(mockUnrepostEvent).toHaveBeenCalledWith('event-1');
  });

  it('opens report modal when report button is clicked', async () => {
    const feedStore = useFeedStore();

    const event = CalendarEvent.fromObject({
      id: 'event-42',
      calendarId: 'remote-cal',
      date: '2025-12-27',
      content: {
        en: {
          language: 'en',
          name: 'Reportable Event',
          description: 'Description',
        },
      },
    });

    feedStore.events = [Object.assign(event, { repostStatus: 'none' as const })];

    const wrapper = mount(FollowedEventsView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    // Modal is not rendered initially
    expect(wrapper.find('.report-dialog').exists()).toBe(false);

    // Install local spy before triggering so we can assert on this specific call
    const showModalSpy = vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(() => {});
    await wrapper.find('button[data-testid="report-button"]').trigger('click');

    expect(wrapper.find('.report-dialog').exists()).toBe(true);
    expect(showModalSpy).toHaveBeenCalled();
  });

  it('closes report modal when modal emits close', async () => {
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

    const wrapper = mount(FollowedEventsView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    // Open the modal
    await wrapper.find('button[data-testid="report-button"]').trigger('click');
    expect(wrapper.find('.report-dialog').exists()).toBe(true);

    // Close via the modal's close button
    await wrapper.find('.report-dialog__close').trigger('click');

    expect(wrapper.find('.report-dialog').exists()).toBe(false);
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

    expect(mockLoadMore).toHaveBeenCalledOnce();
  });
});
