import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, config, RouterLinkStub } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import sinon from 'sinon';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import InboxView from '@/client/components/logged_in/inbox.vue';
import { useNotificationStore } from '@/client/stores/notificationStore';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useEventStore } from '@/client/stores/eventStore';
import NotificationService from '@/client/service/notification';
import CalendarService from '@/client/service/calendar';
import { Notification } from '@/common/model/notification';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';

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

  const makeEvent = (id: string, name: string): CalendarEvent => {
    return CalendarEvent.fromObject({
      id,
      content: {
        en: { name, description: '' },
      },
    });
  };

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);
    sandbox = sinon.createSandbox();

    // RouterLink is a global component from vue-router. Inbox notifications
    // (repost branch) embed a <router-link> for the event title. Use
    // RouterLinkStub so tests do not need a real router instance, while
    // still being able to inspect the `to` prop.
    config.global.stubs = { ...config.global.stubs, RouterLink: RouterLinkStub };

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
              follow_description: '{1} followed {{calendarName}}',
              follow_description_no_calendar: '{1} followed your calendar',
              repost_description: '{1} reposted {2}',
              repost_description_no_event: '{1} reposted one of your events',
              unshare_description: '{{actorName}} unposted a reposted event from {{calendarName}}',
              unshare_description_no_calendar: '{{actorName}} unposted a reposted event from your calendar',
              unshare_description_remote: '{1} unposted your event {2}',
              unshare_description_remote_no_event: '{1} unposted one of your events',
              report_received: 'A report was filed against an event on {{calendarName}}',
              report_received_no_calendar: 'A report was filed against an event on your calendar',
              report_verified: 'A reporter completed verification for a report on {{calendarName}}',
              report_verified_no_calendar: 'A reporter completed verification for a report on your calendar',
              report_escalated: 'A report on {{calendarName}} was escalated for admin review',
              report_escalated_no_calendar: 'A report on your calendar was escalated for admin review',
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
    delete (config.global.stubs as Record<string, unknown>).RouterLink;
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

  it('renders repost notification with actor name as text and fallback phrase when event is not in store', async () => {
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
        stubs: { RouterLink: RouterLinkStub },
      },
    });

    await wrapper.vm.$nextTick();
    // No link when actorUrl is null
    expect(wrapper.find('a.actor-link').exists()).toBe(false);
    expect(wrapper.find('span.actor-name').text()).toBe('Bob');
    // Event not in store → fallback phrase, no router-link rendered
    expect(wrapper.text()).toContain('reposted one of your events');
    expect(wrapper.findComponent(RouterLinkStub).exists()).toBe(false);
  });

  it('renders repost notification with event title as a RouterLink when event is in the eventStore', async () => {
    const eventStore = useEventStore();
    eventStore.setEventsForCalendar('cal-1', [makeEvent('evt-123', 'Pottery Workshop')]);

    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    vi.spyOn(store, 'markAllSeen').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        type: 'repost',
        calendarId: 'cal-1',
        eventId: 'evt-123',
        actorName: 'Bob',
        actorUrl: 'https://example.com/bob',
      }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
        stubs: { RouterLink: RouterLinkStub },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    // Actor link renders
    expect(wrapper.find('a.actor-link').text()).toContain('Bob');
    // Event title is rendered as a RouterLink (stubbed)
    const routerLink = wrapper.findComponent(RouterLinkStub);
    expect(routerLink.exists()).toBe(true);
    expect(routerLink.props('to')).toEqual({
      name: 'event_edit',
      params: { eventId: 'evt-123' },
    });
    expect(routerLink.text()).toContain('Pottery Workshop');
    expect(wrapper.text()).toContain('reposted');
    expect(wrapper.text()).toContain('Pottery Workshop');
  });

  it('falls back to "reposted one of your events" when eventId is in notification but event missing from store', async () => {
    const eventStore = useEventStore();
    eventStore.setEventsForCalendar('cal-1', []);

    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    vi.spyOn(store, 'markAllSeen').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        type: 'repost',
        calendarId: 'cal-1',
        eventId: 'evt-missing',
        actorName: 'Bob',
        actorUrl: 'https://example.com/bob',
      }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
        stubs: { RouterLink: RouterLinkStub },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('reposted one of your events');
    expect(wrapper.findComponent(RouterLinkStub).exists()).toBe(false);
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

  it('renders unshare notification with actor name as plain text and calendar name when calendar is in the store', async () => {
    const calendarStore = useCalendarStore();
    calendarStore.setCalendars([makeCalendar('cal-1', 'my-cal', 'Community Garden Events')]);

    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    vi.spyOn(store, 'markAllSeen').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        type: 'unshare',
        calendarId: 'cal-1',
        actorName: 'Alice',
        // Local actor: actor_url is null (DEC-008 / pv-nb0q convention).
        actorUrl: null,
        eventId: 'evt-1',
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

    // No actor link — local actor has no profile URL
    expect(wrapper.find('a.actor-link').exists()).toBe(false);
    expect(wrapper.text()).toContain('Alice');
    expect(wrapper.text()).toContain('unposted a reposted event from Community Garden Events');
  });

  it('falls back to generic unshare phrasing when calendarId is not in the store', async () => {
    const calendarStore = useCalendarStore();
    calendarStore.setCalendars([]);

    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    vi.spyOn(store, 'markAllSeen').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        type: 'unshare',
        calendarId: 'unknown-cal',
        actorName: 'Alice',
        actorUrl: null,
      }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Alice');
    expect(wrapper.text()).toContain('unposted a reposted event from your calendar');
  });

  it('renders inbound unshare notification with actor link when actorUrl is set', async () => {
    // Inbound actor: actor_url is set, renderer uses i18next slot template
    // with an <a class="actor-link"> anchor — parallels follow/repost rather
    // than the local-flow plain-text branch above. Calendar-style display
    // name reflects the AP model (calendars are the actors for federation
    // actions) per pv-cou0.
    const eventStore = useEventStore();
    eventStore.setEventsForCalendar('cal-1', [makeEvent('evt-123', 'Pottery Workshop')]);

    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    vi.spyOn(store, 'markAllSeen').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        type: 'unshare',
        calendarId: 'cal-1',
        eventId: 'evt-123',
        actorName: 'Brewery Tour Collective',
        actorUrl: 'https://remote.instance/calendars/brewery-tour',
      }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
        stubs: { RouterLink: RouterLinkStub },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    // Actor link renders with the calendar-style display name and the https URL.
    const link = wrapper.find('a.actor-link');
    expect(link.exists()).toBe(true);
    expect(link.text()).toContain('Brewery Tour Collective');
    expect(link.attributes('href')).toBe('https://remote.instance/calendars/brewery-tour');
    expect(link.attributes('rel')).toBe('noopener noreferrer');
    expect(link.attributes('target')).toBe('_blank');
    // The rendered text mentions both the actor and the event title.
    expect(wrapper.text()).toContain('Brewery Tour Collective');
    expect(wrapper.text()).toContain('Pottery Workshop');
    // No span.actor-name fallback when the link is present.
    expect(wrapper.find('span.actor-name').exists()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Report notifications (privacy: no actor info ever rendered)
  // ---------------------------------------------------------------------------

  describe('report notifications', () => {
    it('renders report_received with calendar name and no actor info', async () => {
      const calendarStore = useCalendarStore();
      calendarStore.setCalendars([makeCalendar('cal-1', 'my-cal', 'Community Garden Events')]);

      const store = useNotificationStore();
      vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
      vi.spyOn(store, 'markAllSeen').mockResolvedValue(undefined);
      store.notifications = [
        makeNotification({
          type: 'report_received',
          calendarId: 'cal-1',
          actorName: '',
          actorUrl: null,
        }),
      ];

      const wrapper = mount(InboxView, {
        global: {
          plugins: [pinia, [I18NextVue, { i18next }]],
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('A report was filed against an event on Community Garden Events');
      // Privacy: no actor anchor or span for report rows
      expect(wrapper.find('a.actor-link').exists()).toBe(false);
      expect(wrapper.find('span.actor-name').exists()).toBe(false);
    });

    it('renders report_verified with calendar name and no actor info', async () => {
      const calendarStore = useCalendarStore();
      calendarStore.setCalendars([makeCalendar('cal-1', 'my-cal', 'Community Garden Events')]);

      const store = useNotificationStore();
      vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
      vi.spyOn(store, 'markAllSeen').mockResolvedValue(undefined);
      store.notifications = [
        makeNotification({
          type: 'report_verified',
          calendarId: 'cal-1',
          actorName: '',
          actorUrl: null,
        }),
      ];

      const wrapper = mount(InboxView, {
        global: {
          plugins: [pinia, [I18NextVue, { i18next }]],
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('A reporter completed verification for a report on Community Garden Events');
      expect(wrapper.find('a.actor-link').exists()).toBe(false);
      expect(wrapper.find('span.actor-name').exists()).toBe(false);
    });

    it('renders report_escalated with calendar name and no actor info', async () => {
      const calendarStore = useCalendarStore();
      calendarStore.setCalendars([makeCalendar('cal-1', 'my-cal', 'Community Garden Events')]);

      const store = useNotificationStore();
      vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
      vi.spyOn(store, 'markAllSeen').mockResolvedValue(undefined);
      store.notifications = [
        makeNotification({
          type: 'report_escalated',
          calendarId: 'cal-1',
          actorName: '',
          actorUrl: null,
        }),
      ];

      const wrapper = mount(InboxView, {
        global: {
          plugins: [pinia, [I18NextVue, { i18next }]],
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('A report on Community Garden Events was escalated for admin review');
      expect(wrapper.find('a.actor-link').exists()).toBe(false);
      expect(wrapper.find('span.actor-name').exists()).toBe(false);
    });

    it('falls back to no-calendar phrasing for report_received when calendar is missing', async () => {
      const calendarStore = useCalendarStore();
      calendarStore.setCalendars([]);

      const store = useNotificationStore();
      vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
      vi.spyOn(store, 'markAllSeen').mockResolvedValue(undefined);
      store.notifications = [
        makeNotification({
          type: 'report_received',
          calendarId: 'unknown-cal',
          actorName: '',
          actorUrl: null,
        }),
      ];

      const wrapper = mount(InboxView, {
        global: {
          plugins: [pinia, [I18NextVue, { i18next }]],
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('A report was filed against an event on your calendar');
      expect(wrapper.find('a.actor-link').exists()).toBe(false);
      expect(wrapper.find('span.actor-name').exists()).toBe(false);
    });

    it('never renders actor info even if a report row has non-empty actorName (defense in depth)', async () => {
      const calendarStore = useCalendarStore();
      calendarStore.setCalendars([makeCalendar('cal-1', 'my-cal', 'Community Garden Events')]);

      const store = useNotificationStore();
      vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
      vi.spyOn(store, 'markAllSeen').mockResolvedValue(undefined);
      // Simulate a malformed row — the template must NOT surface the reporter
      // even if upstream wrote bad data. The privacy invariant is enforced
      // server-side; this guards against regression.
      store.notifications = [
        makeNotification({
          type: 'report_received',
          calendarId: 'cal-1',
          actorName: 'should-never-appear',
          actorUrl: 'https://example.com/reporter',
        }),
      ];

      const wrapper = mount(InboxView, {
        global: {
          plugins: [pinia, [I18NextVue, { i18next }]],
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).not.toContain('should-never-appear');
      expect(wrapper.find('a.actor-link').exists()).toBe(false);
    });
  });
});
