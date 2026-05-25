import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import sinon from 'sinon';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import InboxView from '@/client/components/logged_in/inbox.vue';
import { useNotificationStore } from '@/client/stores/notificationStore';
import NotificationService from '@/client/service/notification';
import type { NotificationResponse } from '@/common/model/notification';

describe('InboxView', () => {
  let pinia: ReturnType<typeof createPinia>;
  let sandbox: sinon.SinonSandbox;

  const makeNotification = (overrides: Partial<NotificationResponse> = {}): NotificationResponse => ({
    id: 'notif-1',
    activityId: 'activity-1',
    verb: 'Follow',
    origin: 'federated',
    actor: {
      kind: 'remote_actor',
      displayName: 'Alice',
      displayUrl: 'https://example.com/alice',
    },
    object: {
      type: 'calendar',
      id: 'cal-1',
      label: 'My Calendar',
    },
    seen: false,
    dismissed: false,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  });

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);
    sandbox = sinon.createSandbox();

    // Stub service layer so tests don't make real HTTP requests
    sandbox.stub(NotificationService.prototype, 'getNotifications').resolves([]);

    await i18next.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: {
          inbox: {
            title: 'Notifications',
            noNotifications: 'You have no notifications.',
            flag_actor_anonymous: 'Anonymous reporter',
            flag_actor_remote: 'Reporter from {{host}}',
            notifications: {
              follow_suffix: 'followed your calendar',
              repost_suffix: 'reposted one of your events',
              flag_suffix: 'flagged "{{eventTitle}}"',
              editor_invited_suffix: 'invited you to edit "{{calendarName}}"',
              editor_revoked_suffix: 'removed your editor access to "{{calendarName}}"',
              report_escalated_sentence: 'A report on "{{eventTitle}}" was escalated',
              report_resolved_sentence: 'A report on "{{eventTitle}}" was resolved',
              empty_state: 'No notifications yet',
              loading_more: 'Loading more notifications...',
              opens_in_new_tab: '(opens in new tab)',
              dismiss_aria_label: 'Dismiss notification',
              mark_seen_aria_label: 'Mark notification as read',
              unread_badge: 'Unread',
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
    store.notifications = [
      makeNotification({
        id: 'n1',
        verb: 'Follow',
        actor: { kind: 'remote_actor', displayName: 'Alice', displayUrl: 'https://example.com/alice' },
      }),
      makeNotification({
        id: 'n2',
        verb: 'Announce',
        actor: { kind: 'remote_actor', displayName: 'Bob', displayUrl: null },
        object: { type: 'event', id: 'evt-1', label: 'Town Hall' },
      }),
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

  it('renders follow notification with actor link and follow suffix', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        verb: 'Follow',
        actor: { kind: 'remote_actor', displayName: 'Alice', displayUrl: 'https://example.com/alice' },
      }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    const link = wrapper.find('a.actor-link');
    expect(link.exists()).toBe(true);
    expect(link.text()).toContain('Alice');
    expect(link.attributes('href')).toBe('https://example.com/alice');
    expect(link.attributes('rel')).toBe('noopener noreferrer');
    expect(link.attributes('target')).toBe('_blank');
    expect(wrapper.text()).toContain('followed your calendar');
  });

  it('renders repost notification with actor name as text when displayUrl is null', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        verb: 'Announce',
        actor: { kind: 'remote_actor', displayName: 'Bob', displayUrl: null },
        object: { type: 'event', id: 'evt-123', label: 'Town Hall' },
      }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    // No link when displayUrl is null
    expect(wrapper.find('a.actor-link').exists()).toBe(false);
    expect(wrapper.find('span.actor-name').text()).toBe('Bob');
    expect(wrapper.text()).toContain('reposted one of your events');
  });

  it('renders actor displayName via text interpolation, never with v-html', async () => {
    const maliciousName = '<script>alert("xss")</script>';
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        verb: 'Follow',
        actor: { kind: 'anonymous', displayName: maliciousName, displayUrl: null },
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
    store.notifications = [makeNotification()];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="scroll-sentinel"]').exists()).toBe(true);
  });

  it('calls fetchNotifications on mount', async () => {
    const store = useNotificationStore();
    const fetchSpy = vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);

    mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    // Allow onMounted async work to complete
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('does not show empty state while loading', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
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
    store.notifications = [
      makeNotification({
        actor: { kind: 'remote_actor', displayName: 'Charlie', displayUrl: 'https://remote.example/charlie' },
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

  it('refuses to render an actor link for a non-https displayUrl (javascript: scheme)', async () => {
    // Defense-in-depth: a federated peer cannot inject `javascript:` today
    // (the server populates `actor_display_url` from the AP profile URL),
    // but the template's scheme guard must drop the link if one ever
    // appears. The fallback is the plain-text actor name.
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        verb: 'Follow',
        actor: {
          kind: 'remote_actor',
          displayName: 'Mallory',
          displayUrl: 'javascript:alert(1)',
        },
      }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    expect(wrapper.find('a.actor-link').exists()).toBe(false);
    expect(wrapper.find('span.actor-name').text()).toBe('Mallory');
  });

  it('renders Flag actor as plain text with no link when displayUrl is null', async () => {
    // Flag rows are server-anonymized — `actor.kind='anonymous'` and
    // `displayUrl` is null for local/web-form Flags. The inbox must
    // render the anonymized display name with no actor link.
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        verb: 'Flag',
        actor: { kind: 'anonymous', displayName: 'Anonymous reporter', displayUrl: null },
        object: { type: 'report', id: 'rep-1', label: 'Reported Event' },
      }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    expect(wrapper.find('a.actor-link').exists()).toBe(false);
    expect(wrapper.find('span.actor-name').text()).toBe('Anonymous reporter');
  });

  it('resolves the anonymous Flag i18n token at render time, never showing the raw token', async () => {
    // The server stores `actor.displayName` as `i18n:flag_actor_anonymous`
    // for fully-anonymous Flag rows. The inbox must render the recipient's
    // localized string ("Anonymous reporter" in en), not the raw token.
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        verb: 'Flag',
        actor: {
          kind: 'anonymous',
          displayName: 'i18n:flag_actor_anonymous',
          displayUrl: null,
        },
        object: { type: 'report', id: 'rep-anon', label: 'Reported Event' },
      }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    expect(wrapper.text()).not.toContain('i18n:flag_actor_anonymous');
    expect(wrapper.find('span.actor-name').text()).toBe('Anonymous reporter');
  });

  it('resolves the remote Flag i18n token with host param at render time', async () => {
    // Federated Flag rows carry the per-host token
    // `i18n:flag_actor_remote{host:<host>}` and an instance-root URL.
    // The inbox must substitute the host into the translation
    // ("Reporter from example.org") and render an actor link to the
    // instance root.
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        verb: 'Flag',
        actor: {
          kind: 'anonymous',
          displayName: 'i18n:flag_actor_remote{host:example.org}',
          displayUrl: 'https://example.org',
        },
        object: { type: 'report', id: 'rep-remote', label: 'Reported Event' },
      }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    expect(wrapper.text()).not.toContain('i18n:flag_actor_remote');
    expect(wrapper.text()).not.toContain('{host:');
    const link = wrapper.find('a.actor-link');
    expect(link.exists()).toBe(true);
    expect(link.text()).toContain('Reporter from example.org');
    expect(link.attributes('href')).toBe('https://example.org');
  });

  it('renders the Flag suffix with the snapshotted event title', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        verb: 'Flag',
        actor: { kind: 'anonymous', displayName: 'Anonymous reporter', displayUrl: null },
        object: { type: 'report', id: 'rep-1', label: 'Yoga in the Park' },
      }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    expect(wrapper.find('p.notification-text').text()).toBe('Anonymous reporter flagged "Yoga in the Park"');
  });

  it('renders the EditorInvited suffix with the calendar name', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        verb: 'EditorInvited',
        actor: { kind: 'account', displayName: 'Bob', displayUrl: null },
        object: { type: 'calendar', id: 'cal-1', label: 'Community Events' },
      }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    expect(wrapper.find('p.notification-text').text()).toBe('Bob invited you to edit "Community Events"');
  });

  it('renders the EditorRevoked suffix with the calendar name', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        verb: 'EditorRevoked',
        actor: { kind: 'account', displayName: 'Carol', displayUrl: null },
        object: { type: 'calendar', id: 'cal-1', label: 'Community Events' },
      }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    expect(wrapper.find('p.notification-text').text()).toBe('Carol removed your editor access to "Community Events"');
  });

  it('renders ReportEscalated as a standalone sentence with no actor element when actor is system', async () => {
    // ReportEscalated rows carry `actor.kind='system'` with displayName ''.
    // The row must render as a complete sentence with no empty actor span /
    // anchor preceding it.
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        verb: 'ReportEscalated',
        actor: { kind: 'system', displayName: '', displayUrl: null },
        object: { type: 'report', id: 'rep-1', label: 'Yoga in the Park' },
      }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    expect(wrapper.find('a.actor-link').exists()).toBe(false);
    expect(wrapper.find('span.actor-name').exists()).toBe(false);
    expect(wrapper.find('p.notification-text').text()).toBe('A report on "Yoga in the Park" was escalated');
  });

  it('renders ReportResolved as a standalone sentence with no actor element when actor is system', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        verb: 'ReportResolved',
        actor: { kind: 'system', displayName: '', displayUrl: null },
        object: { type: 'report', id: 'rep-1', label: 'Yoga in the Park' },
      }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    expect(wrapper.find('a.actor-link').exists()).toBe(false);
    expect(wrapper.find('span.actor-name').exists()).toBe(false);
    expect(wrapper.find('p.notification-text').text()).toBe('A report on "Yoga in the Park" was resolved');
  });

  it('applies the unread modifier class to unseen rows and removes it for seen rows', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({ id: 'n1', seen: false }),
      makeNotification({ id: 'n2', seen: true }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    const items = wrapper.findAll('[data-testid="notification-item"]');
    expect(items[0].classes()).toContain('notification-item--unread');
    expect(items[1].classes()).not.toContain('notification-item--unread');
  });

  it('calls store.markSeen when an unread row is clicked', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    const markSeenSpy = vi.spyOn(store, 'markSeen').mockResolvedValue(undefined);
    store.notifications = [makeNotification({ id: 'n1', seen: false })];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    await wrapper.find('[data-testid="notification-item"]').trigger('click');

    expect(markSeenSpy).toHaveBeenCalledWith('n1');
  });

  it('does NOT call store.markSeen when an already-seen row is clicked', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    const markSeenSpy = vi.spyOn(store, 'markSeen').mockResolvedValue(undefined);
    store.notifications = [makeNotification({ id: 'n1', seen: true })];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    await wrapper.find('[data-testid="notification-item"]').trigger('click');

    expect(markSeenSpy).not.toHaveBeenCalled();
  });

  it('renders a dismiss button on every row with an accessible label', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({ id: 'n1' }),
      makeNotification({ id: 'n2' }),
    ];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    const buttons = wrapper.findAll('[data-testid="notification-dismiss"]');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].attributes('aria-label')).toBe('Dismiss notification');
  });

  it('calls store.markDismissed when the dismiss button is clicked', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    const markDismissedSpy = vi.spyOn(store, 'markDismissed').mockResolvedValue(undefined);
    store.notifications = [makeNotification({ id: 'n1', seen: false })];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    await wrapper.find('[data-testid="notification-dismiss"]').trigger('click');

    expect(markDismissedSpy).toHaveBeenCalledWith('n1');
  });

  it('does NOT also trigger markSeen when the dismiss button is clicked (click.stop on the button)', async () => {
    // Defense: the row's click handler marks seen, and the button sits
    // inside the row. The button must call .stop so a dismiss click does
    // not also flip the seen flag (the dismissed row is being removed
    // anyway — the duplicate PATCH would be wasted work).
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    const markSeenSpy = vi.spyOn(store, 'markSeen').mockResolvedValue(undefined);
    vi.spyOn(store, 'markDismissed').mockResolvedValue(undefined);
    store.notifications = [makeNotification({ id: 'n1', seen: false })];

    const wrapper = mount(InboxView, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
      },
    });

    await wrapper.vm.$nextTick();
    await wrapper.find('[data-testid="notification-dismiss"]').trigger('click');

    expect(markSeenSpy).not.toHaveBeenCalled();
  });
});
