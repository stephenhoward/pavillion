import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';
import InboxView from '@/client/components/logged_in/inbox.vue';
import { useNotificationStore } from '@/client/stores/notificationStore';
import NotificationService from '@/client/service/notification';
import type { NotificationResponse } from '@/common/model/notification';
import { mountComponent } from '@/client/test/lib/vue';

// The inbox links object labels through <router-link>, so every mount needs a
// router carrying the four named routes `routeFor` can produce.
const routes: RouteRecordRaw[] = [
  { path: '/', component: {}, name: 'home' },
  { path: '/event/:eventId', component: {}, name: 'event_edit' },
  { path: '/calendar/:calendar/manage', component: {}, name: 'calendar_management' },
  { path: '/admin/moderation/reports/:reportId', component: {}, name: 'moderation_report_detail' },
];

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
      target: null,
    },
    seen: false,
    dismissed: false,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  });

  const mountInbox = async () => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push('/');
    await router.isReady();

    const wrapper = mountComponent(InboxView, router, { pinia });
    await wrapper.vm.$nextTick();
    return wrapper;
  };

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    sandbox = sinon.createSandbox();

    // Stub service layer so tests don't make real HTTP requests
    sandbox.stub(NotificationService.prototype, 'getNotifications').resolves([]);
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

    const wrapper = await mountInbox();

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
        object: { type: 'event', id: 'evt-1', label: 'Town Hall', target: null },
      }),
    ];

    const wrapper = await mountInbox();

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

    const wrapper = await mountInbox();

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
        object: { type: 'event', id: 'evt-123', label: 'Town Hall', target: null },
      }),
    ];

    const wrapper = await mountInbox();

    // No link when displayUrl is null
    expect(wrapper.find('a.actor-link').exists()).toBe(false);
    expect(wrapper.find('span.actor-name').text()).toBe('Bob');
    expect(wrapper.find('p.notification-text').text()).toBe('Bob reposted Town Hall');
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

    const wrapper = await mountInbox();

    // The raw script tag must NOT appear as actual HTML — it should be escaped
    expect(wrapper.find('script').exists()).toBe(false);
    // But the text content should show the string safely
    expect(wrapper.text()).toContain('alert');
  });

  it('renders the object label via text interpolation, never with v-html', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        verb: 'Announce',
        actor: { kind: 'remote_actor', displayName: 'Bob', displayUrl: null },
        object: {
          type: 'event',
          id: 'evt-1',
          label: '<img src=x onerror="alert(1)">',
          target: { kind: 'event', eventId: 'evt-1' },
        },
      }),
    ];

    const wrapper = await mountInbox();

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('a.object-link').text()).toBe('<img src=x onerror="alert(1)">');
  });

  it('has a scroll sentinel element when there are notifications', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    store.notifications = [makeNotification()];

    const wrapper = await mountInbox();

    expect(wrapper.find('[data-testid="scroll-sentinel"]').exists()).toBe(true);
  });

  it('calls fetchNotifications on mount', async () => {
    const store = useNotificationStore();
    const fetchSpy = vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);

    await mountInbox();

    // Allow onMounted async work to complete
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('does not show empty state while loading', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    store.notifications = [];
    store.isLoading = true;

    const wrapper = await mountInbox();

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

    const wrapper = await mountInbox();

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

    const wrapper = await mountInbox();

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
        object: { type: 'report', id: 'rep-1', label: 'Reported Event', target: null },
      }),
    ];

    const wrapper = await mountInbox();

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
        object: { type: 'report', id: 'rep-anon', label: 'Reported Event', target: null },
      }),
    ];

    const wrapper = await mountInbox();

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
        object: { type: 'report', id: 'rep-remote', label: 'Reported Event', target: null },
      }),
    ];

    const wrapper = await mountInbox();

    expect(wrapper.text()).not.toContain('i18n:flag_actor_remote');
    expect(wrapper.text()).not.toContain('{host:');
    const link = wrapper.find('a.actor-link');
    expect(link.exists()).toBe(true);
    expect(link.text()).toContain('Reporter from example.org');
    expect(link.attributes('href')).toBe('https://example.org');
  });

  it('renders the Flag sentence with the snapshotted event title', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        verb: 'Flag',
        actor: { kind: 'anonymous', displayName: 'Anonymous reporter', displayUrl: null },
        object: { type: 'report', id: 'rep-1', label: 'Yoga in the Park', target: null },
      }),
    ];

    const wrapper = await mountInbox();

    expect(wrapper.find('p.notification-text').text()).toBe('Anonymous reporter flagged Yoga in the Park');
  });

  it('renders the EditorInvited sentence with the calendar name', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        verb: 'EditorInvited',
        actor: { kind: 'account', displayName: 'Bob', displayUrl: null },
        object: { type: 'calendar', id: 'cal-1', label: 'Community Events', target: null },
      }),
    ];

    const wrapper = await mountInbox();

    expect(wrapper.find('p.notification-text').text()).toBe('Bob invited you to edit Community Events');
  });

  it('renders the EditorRevoked suffix with the calendar name', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        verb: 'EditorRevoked',
        actor: { kind: 'account', displayName: 'Carol', displayUrl: null },
        object: { type: 'calendar', id: 'cal-1', label: 'Community Events', target: null },
      }),
    ];

    const wrapper = await mountInbox();

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
        object: { type: 'report', id: 'rep-1', label: 'Yoga in the Park', target: null },
      }),
    ];

    const wrapper = await mountInbox();

    expect(wrapper.find('a.actor-link').exists()).toBe(false);
    expect(wrapper.find('span.actor-name').exists()).toBe(false);
    expect(wrapper.find('p.notification-text').text()).toBe('A report on Yoga in the Park was escalated');
  });

  it('renders ReportResolved as a standalone sentence with no actor element when actor is system', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({
        verb: 'ReportResolved',
        actor: { kind: 'system', displayName: '', displayUrl: null },
        object: { type: 'report', id: 'rep-1', label: 'Yoga in the Park', target: null },
      }),
    ];

    const wrapper = await mountInbox();

    expect(wrapper.find('a.actor-link').exists()).toBe(false);
    expect(wrapper.find('span.actor-name').exists()).toBe(false);
    expect(wrapper.find('p.notification-text').text()).toBe('A report on Yoga in the Park was resolved');
  });

  it('applies the unread modifier class to unseen rows and removes it for seen rows', async () => {
    const store = useNotificationStore();
    vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
    store.notifications = [
      makeNotification({ id: 'n1', seen: false }),
      makeNotification({ id: 'n2', seen: true }),
    ];

    const wrapper = await mountInbox();

    const items = wrapper.findAll('[data-testid="notification-item"]');
    expect(items[0].classes()).toContain('notification-item--unread');
    expect(items[1].classes()).not.toContain('notification-item--unread');
  });

  describe('row is a container, not a control', () => {
    it('gives the row no role, tabindex, or static aria-label', async () => {
      const store = useNotificationStore();
      vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
      store.notifications = [makeNotification({ id: 'n1', seen: false })];

      const wrapper = await mountInbox();

      const item = wrapper.find('[data-testid="notification-item"]');
      expect(item.attributes('role')).toBeUndefined();
      expect(item.attributes('tabindex')).toBeUndefined();
      expect(item.attributes('aria-label')).toBeUndefined();
    });

    it('does not mark a row seen when the row itself is clicked', async () => {
      const store = useNotificationStore();
      vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
      const markSeenSpy = vi.spyOn(store, 'markSeen').mockResolvedValue(undefined);
      store.notifications = [makeNotification({ id: 'n1', seen: false })];

      const wrapper = await mountInbox();
      await wrapper.find('[data-testid="notification-item"]').trigger('click');

      expect(markSeenSpy).not.toHaveBeenCalled();
    });

    it('nests no interactive element inside another interactive element', async () => {
      const store = useNotificationStore();
      vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
      store.notifications = [
        makeNotification({
          id: 'n1',
          verb: 'Announce',
          seen: false,
          actor: { kind: 'remote_actor', displayName: 'Bob', displayUrl: 'https://example.com/bob' },
          object: {
            type: 'event',
            id: 'evt-1',
            label: 'Town Hall',
            target: { kind: 'event', eventId: 'evt-1' },
          },
        }),
      ];

      const wrapper = await mountInbox();

      expect(wrapper.findAll('a a, a button, button a, button button')).toHaveLength(0);
    });

    it('orders the row focus stops actor, object, mark-as-read, dismiss', async () => {
      const store = useNotificationStore();
      vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
      store.notifications = [
        makeNotification({
          id: 'n1',
          verb: 'Announce',
          seen: false,
          actor: { kind: 'remote_actor', displayName: 'Bob', displayUrl: 'https://example.com/bob' },
          object: {
            type: 'event',
            id: 'evt-1',
            label: 'Town Hall',
            target: { kind: 'event', eventId: 'evt-1' },
          },
        }),
      ];

      const wrapper = await mountInbox();

      const stops = wrapper.find('[data-testid="notification-item"]').findAll('a, button');
      expect(stops.map((stop) => stop.attributes('class'))).toEqual([
        'actor-link',
        'object-link',
        'mark-seen',
        'dismiss-button',
      ]);
    });
  });

  describe('object link', () => {
    it('renders a router-link to the target route when the object has a target', async () => {
      const store = useNotificationStore();
      vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
      store.notifications = [
        makeNotification({
          verb: 'Announce',
          actor: { kind: 'remote_actor', displayName: 'Bob', displayUrl: null },
          object: {
            type: 'event',
            id: 'evt-1',
            label: 'Town Hall',
            target: { kind: 'event', eventId: 'evt-1' },
          },
        }),
      ];

      const wrapper = await mountInbox();

      const link = wrapper.find('a.object-link');
      expect(link.exists()).toBe(true);
      expect(link.text()).toBe('Town Hall');
      expect(link.attributes('href')).toBe('/event/evt-1');
      // Internal navigation stays in the tab — the new-tab treatment belongs
      // to the external actor anchor only.
      expect(link.attributes('target')).toBeUndefined();
      expect(link.attributes('rel')).toBeUndefined();
      expect(link.text()).not.toContain('opens in new tab');
    });

    it('routes an owner_report target to the calendar reports tab', async () => {
      const store = useNotificationStore();
      vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
      store.notifications = [
        makeNotification({
          verb: 'ReportEscalated',
          actor: { kind: 'system', displayName: '', displayUrl: null },
          object: {
            type: 'report',
            id: 'rep-1',
            label: 'Yoga in the Park',
            target: { kind: 'owner_report', reportId: 'rep-1', calendarUrlName: 'my-calendar' },
          },
        }),
      ];

      const wrapper = await mountInbox();

      const link = wrapper.find('a.object-link');
      expect(link.attributes('href')).toBe('/calendar/my-calendar/manage?tab=reports&report=rep-1');
    });

    it('renders the object label as plain text when the target is null', async () => {
      const store = useNotificationStore();
      vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
      store.notifications = [
        makeNotification({
          verb: 'Announce',
          actor: { kind: 'remote_actor', displayName: 'Bob', displayUrl: null },
          object: { type: 'event', id: 'evt-1', label: 'Town Hall', target: null },
        }),
      ];

      const wrapper = await mountInbox();

      expect(wrapper.find('a.object-link').exists()).toBe(false);
      expect(wrapper.find('span.object-label').text()).toBe('Town Hall');
    });
  });

  describe('row controls', () => {
    it('labels both controls with the row content rendered in the sentence', async () => {
      const store = useNotificationStore();
      vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
      store.notifications = [
        makeNotification({
          id: 'n1',
          verb: 'Announce',
          seen: false,
          actor: { kind: 'remote_actor', displayName: 'Bob', displayUrl: null },
          object: {
            type: 'event',
            id: 'evt-1',
            label: 'Town Hall',
            target: { kind: 'event', eventId: 'evt-1' },
          },
        }),
      ];

      const wrapper = await mountInbox();

      expect(wrapper.find('[data-testid="notification-mark-seen"]').attributes('aria-label'))
        .toBe('Mark as read: Bob reposted Town Hall');
      expect(wrapper.find('[data-testid="notification-dismiss"]').attributes('aria-label'))
        .toBe('Dismiss: Bob reposted Town Hall');
    });

    it('names Flag controls with the resolved anonymisation token, never the raw actor host or URI', async () => {
      // The aria-labels are built from the same resolved string the row
      // renders. Formatting them from raw actor fields would be a second
      // code path where anonymisation could be skipped.
      const store = useNotificationStore();
      vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
      store.notifications = [
        makeNotification({
          id: 'n1',
          verb: 'Flag',
          seen: false,
          actor: {
            kind: 'anonymous',
            displayName: 'i18n:flag_actor_remote{host:example.org}',
            displayUrl: 'https://example.org',
          },
          object: { type: 'report', id: 'rep-1', label: 'Yoga in the Park', target: null },
        }),
      ];

      const wrapper = await mountInbox();

      for (const testid of ['notification-mark-seen', 'notification-dismiss']) {
        const label = wrapper.find(`[data-testid="${testid}"]`).attributes('aria-label') ?? '';
        expect(label).toContain('Reporter from example.org');
        expect(label).toContain('Yoga in the Park');
        expect(label).not.toContain('i18n:');
        expect(label).not.toContain('https://');
      }
    });

    it('calls store.markSeen when the mark-as-read button is clicked', async () => {
      const store = useNotificationStore();
      vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
      const markSeenSpy = vi.spyOn(store, 'markSeen').mockResolvedValue(undefined);
      store.notifications = [makeNotification({ id: 'n1', seen: false })];

      const wrapper = await mountInbox();
      await wrapper.find('[data-testid="notification-mark-seen"]').trigger('click');

      expect(markSeenSpy).toHaveBeenCalledWith('n1');
    });

    it('offers no mark-as-read control on an already-seen row', async () => {
      const store = useNotificationStore();
      vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
      const markSeenSpy = vi.spyOn(store, 'markSeen').mockResolvedValue(undefined);
      store.notifications = [makeNotification({ id: 'n1', seen: true })];

      const wrapper = await mountInbox();

      expect(wrapper.find('[data-testid="notification-mark-seen"]').exists()).toBe(false);
      expect(markSeenSpy).not.toHaveBeenCalled();
    });

    it('renders a dismiss button on every row, seen or unseen', async () => {
      const store = useNotificationStore();
      vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
      store.notifications = [
        makeNotification({ id: 'n1', seen: false }),
        makeNotification({ id: 'n2', seen: true }),
      ];

      const wrapper = await mountInbox();

      const buttons = wrapper.findAll('[data-testid="notification-dismiss"]');
      expect(buttons).toHaveLength(2);
      expect(buttons[0].attributes('aria-label')).toBe('Dismiss: Alice followed your calendar');
    });

    it('calls store.markDismissed when the dismiss button is clicked', async () => {
      const store = useNotificationStore();
      vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
      const markDismissedSpy = vi.spyOn(store, 'markDismissed').mockResolvedValue(undefined);
      store.notifications = [makeNotification({ id: 'n1', seen: false })];

      const wrapper = await mountInbox();
      await wrapper.find('[data-testid="notification-dismiss"]').trigger('click');

      expect(markDismissedSpy).toHaveBeenCalledWith('n1');
    });

    it('does not also mark a row seen when the dismiss button is clicked', async () => {
      // The row carries no click handler any more, so dismissing cannot
      // flip the seen flag as a side effect — no event-propagation guard
      // is needed to keep it that way.
      const store = useNotificationStore();
      vi.spyOn(store, 'fetchNotifications').mockResolvedValue(undefined);
      const markSeenSpy = vi.spyOn(store, 'markSeen').mockResolvedValue(undefined);
      vi.spyOn(store, 'markDismissed').mockResolvedValue(undefined);
      store.notifications = [makeNotification({ id: 'n1', seen: false })];

      const wrapper = await mountInbox();
      await wrapper.find('[data-testid="notification-dismiss"]').trigger('click');

      expect(markSeenSpy).not.toHaveBeenCalled();
    });
  });
});
