import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import sinon from 'sinon';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import InboxView from '@/client/components/logged_in/inbox.vue';
import { useNotificationStore } from '@/client/stores/notificationStore';
import { useCalendarStore } from '@/client/stores/calendarStore';
import NotificationService from '@/client/service/notification';
import CalendarService from '@/client/service/calendar';
import { Notification } from '@/common/model/notification';
import { Calendar } from '@/common/model/calendar';

describe('InboxView', () => {
  let pinia: ReturnType<typeof createPinia>;
  let sandbox: sinon.SinonSandbox;

  const makeNotification = (overrides: Partial<Record<string, any>> = {}): Notification =>
    Notification.fromObject({
      id: 'notif-1',
      type: 'follow',
      calendarId: 'cal-1',
      eventId: null,
      actorName: 'Alice',
      actorUrl: 'https://example.com/alice',
      seen: false,
      createdAt: '2026-01-01T00:00:00Z',
      ...overrides,
    });

  const makeCalendar = (id: string, urlName: string, name: string): Calendar => {
    return Calendar.fromObject({
      id,
      urlName,
      content: {
        en: { name, description: '' },
      },
    });
  };

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);
    sandbox = sinon.createSandbox();

    // Stub service layer so tests don't make real HTTP requests
    sandbox.stub(NotificationService.prototype, 'getNotifications').resolves([]);
    sandbox.stub(NotificationService.prototype, 'markAllSeen').resolves();
    // The inbox view triggers a calendar hydration on mount; stub it so
    // tests can seed the store directly without going through HTTP.
    sandbox.stub(CalendarService.prototype, 'loadCalendars').callsFake(async function (this: CalendarService) {
      return this.store.calendars;
    });

    await i18next.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: {
          inbox: {
            title: 'Notifications',
            noNotifications: 'You have no notifications.',
            notifications: {
              repost_suffix: 'reposted one of your events',
              follow_description: '{1} followed {{calendarName}}',
              follow_description_no_calendar: '{1} followed your calendar',
              empty_state: 'No notifications yet',
              loading_more: 'Loading more notifications...',
              opens_in_new_tab: '(opens in new tab)',
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

  it('shows empty state when store has no notifications and is not loading', async () => {
    const store = useNotificationStore();
    // Pre-stub store methods to avoid timing issues
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    vi.spyOn(store, 'markAllSeen').mockResolvedValue(undefined);
    store.notifications = [];
    store.isLoading = false;

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    // Allow onMounted async work to complete
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('No notifications yet');
    expect(wrapper.findAll('[data-testid="notification-item"]')).toHaveLength(0);
  });

  it('renders a list of notifications from the store', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    vi.spyOn(store, 'markAllSeen').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({ id: 'n1', type: 'follow', actorName: 'Alice' }),
      makeNotification({ id: 'n2', type: 'repost', actorName: 'Bob', actorUrl: null }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    const items = wrapper.findAll('[data-testid="notification-item"]');
    expect(items).toHaveLength(2);
  });

  it('renders follow notification with actor link and calendar name when calendar is in the store', async () => {
    const calendarStore = useCalendarStore();
    calendarStore.setCalendars([makeCalendar('cal-1', 'my-cal', 'Community Garden Events')]);

    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    vi.spyOn(store, 'markAllSeen').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        type: 'follow',
        calendarId: 'cal-1',
        actorName: 'Alice',
        actorUrl: 'https://example.com/alice',
      }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    // Allow onMounted async work (calendar hydration) to complete
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    const link = wrapper.find('a.actor-link');
    expect(link.exists()).toBe(true);
    expect(link.text()).toContain('Alice');
    expect(link.attributes('href')).toBe('https://example.com/alice');
    expect(link.attributes('rel')).toBe('noopener noreferrer');
    expect(link.attributes('target')).toBe('_blank');
    expect(wrapper.text()).toContain('followed Community Garden Events');
  });

  it('falls back to generic "followed your calendar" phrasing when calendarId is not in the store', async () => {
    const calendarStore = useCalendarStore();
    calendarStore.setCalendars([]);

    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    vi.spyOn(store, 'markAllSeen').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        type: 'follow',
        calendarId: 'unknown-cal',
        actorName: 'Alice',
        actorUrl: 'https://example.com/alice',
      }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('a.actor-link').exists()).toBe(true);
    expect(wrapper.text()).toContain('followed your calendar');
    expect(wrapper.text()).not.toContain('followed undefined');
  });

  it('shows distinct calendar names for follow notifications across multiple calendars', async () => {
    const calendarStore = useCalendarStore();
    calendarStore.setCalendars([
      makeCalendar('cal-a', 'cal-a', 'Pottery Studio'),
      makeCalendar('cal-b', 'cal-b', 'Bike Repair Co-op'),
    ]);

    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    vi.spyOn(store, 'markAllSeen').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({ id: 'n1', type: 'follow', calendarId: 'cal-a', actorName: 'Alice' }),
      makeNotification({ id: 'n2', type: 'follow', calendarId: 'cal-b', actorName: 'Bob' }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    const items = wrapper.findAll('[data-testid="notification-item"]');
    expect(items[0].text()).toContain('Pottery Studio');
    expect(items[1].text()).toContain('Bike Repair Co-op');
  });

  it('renders repost notification with actor name as text when no actorUrl', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    vi.spyOn(store, 'markAllSeen').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        type: 'repost',
        actorName: 'Bob',
        actorUrl: null,
        eventId: 'evt-123',
      }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    // No link when actorUrl is null
    expect(wrapper.find('a.actor-link').exists()).toBe(false);
    expect(wrapper.find('span.actor-name').text()).toBe('Bob');
    expect(wrapper.text()).toContain('reposted one of your events');
  });

  it('renders actor_name via text interpolation, never with v-html', async () => {
    const maliciousName = '<script>alert("xss")</script>';
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    vi.spyOn(store, 'markAllSeen').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        type: 'follow',
        actorName: maliciousName,
        actorUrl: null,
      }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    // The raw script tag must NOT appear as actual HTML — it should be escaped
    expect(wrapper.find('script').exists()).toBe(false);
    // But the text content should show the string safely
    expect(wrapper.text()).toContain('alert');
  });

  it('has a scroll sentinel element when there are notifications', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    vi.spyOn(store, 'markAllSeen').mockResolvedValue(undefined);
    store.notifications = [makeNotification()];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="scroll-sentinel"]').exists()).toBe(true);
  });

  it('calls fetchNotifications and markAllSeen on mount', async () => {
    const store = useNotificationStore();
    const fetchSpy = vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    const markSpy = vi.spyOn(store, 'markAllSeen').mockResolvedValue(undefined);

    mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    // Allow onMounted async work to complete
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(markSpy).toHaveBeenCalledOnce();
  });

  it('does not show empty state while loading', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    vi.spyOn(store, 'markAllSeen').mockResolvedValue(undefined);
    store.notifications = [];
    store.isLoading = true;

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    // Empty state should not appear during loading
    const emptyState = wrapper.find('.empty-state');
    expect(emptyState.exists()).toBe(false);
  });

  it('actor link has rel="noopener noreferrer" and target="_blank"', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    vi.spyOn(store, 'markAllSeen').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        actorName: 'Charlie',
        actorUrl: 'https://remote.example/charlie',
      }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    const link = wrapper.find('a.actor-link');
    expect(link.attributes('rel')).toBe('noopener noreferrer');
    expect(link.attributes('target')).toBe('_blank');
  });
});
