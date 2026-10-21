import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { flushPromises, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import { createMemoryHistory, createRouter, Router, useRoute } from 'vue-router';
import { mountComponent } from '@/client/test/lib/vue';
import { installMatchMedia, type FakeMatchMedia } from '@/client/test/lib/match-media';
import { resetShellLayoutForTesting } from '@/client/composables/useShellLayout';
import SettingsRoot from '@/client/components/logged_in/settings/root.vue';
import SettingsListPage from '@/client/components/logged_in/settings/list-page.vue';
import CalendarService from '@/client/service/calendar';
import FundingService from '@/client/service/funding';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useFundingStore } from '@/client/stores/fundingStore';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';

const App = { template: '<RouterView />' };
const Pane = { template: '<div data-testid="pane" />' };
const Outlet = { template: '<RouterView />' };

// Stands in for calendar-management/root.vue: it reads the calendar param
// once, at setup, and counts its setups so a test can tell a remount from a
// reused instance.
let calendarParentSetups = 0;
const CalendarParent = {
  setup() {
    calendarParentSetups += 1;
    return { mountedFor: useRoute().params.calendar };
  },
  template: '<div data-testid="calendar-parent" :data-mounted-for="mountedFor"><RouterView /></div>',
};

// Shared by leaves of more than one group, so the component alone never
// forces a remount between them and only the pane key can.
let leafSetups = 0;
const CountingLeaf = {
  setup() {
    leafSetups += 1;
    return {};
  },
  template: '<div data-testid="pane" />',
};

function calendar(id: string, urlName: string, name: string): Calendar {
  const cal = new Calendar(id, urlName);
  cal.content('en').name = name;
  return cal;
}

// The settings subtree as it will stand once the calendar and admin indexes
// exist, with stub leaves. The tree and list page resolve every leaf name, so
// each one is registered.
function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/settings', component: SettingsRoot, meta: { shellRail: true }, children: [
        { path: '', component: SettingsListPage, name: 'settings', meta: { settingsGroup: 'root' } },
        { path: 'calendar/:calendar', component: CalendarParent, children: [
          { path: '', component: SettingsListPage, name: 'calendar_management', meta: { settingsGroup: 'calendar' } },
          { path: 'general', component: Pane, name: 'calendar_general' },
          { path: 'editors', component: Pane, name: 'calendar_editors' },
          { path: 'reports', component: Pane, name: 'calendar_reports' },
          { path: 'reports/:reportId', component: Pane, name: 'calendar_report_detail' },
          { path: 'import', component: Pane, name: 'calendar_import' },
          { path: 'widget', component: Pane, name: 'calendar_widget' },
        ] },
        { path: 'account', component: SettingsListPage, name: 'account', meta: { settingsGroup: 'account' } },
        { path: 'account/profile', component: CountingLeaf, name: 'profile' },
        { path: 'account/security', component: CountingLeaf, name: 'security' },
        { path: 'account/calendars', component: CountingLeaf, name: 'account_calendars' },
        { path: 'account/funding', component: Pane, name: 'funding_plan' },
        // A two-hop guard chain ending on a leaf, and an index stub whose
        // guard forwards the way the real index guards do at md+.
        { path: 'forward-a', component: Pane, name: 'forward_a', beforeEnter: () => ({ name: 'forward_b', replace: true }) },
        { path: 'forward-b', component: Pane, name: 'forward_b', beforeEnter: () => ({ name: 'profile', replace: true }) },
        {
          path: 'account-index',
          component: SettingsListPage,
          name: 'account_index_stub',
          meta: { settingsGroup: 'account' },
          beforeEnter: () => ({ name: 'profile', replace: true }),
        },
        { path: 'admin', component: Outlet, children: [
          { path: '', component: SettingsListPage, name: 'admin', meta: { settingsGroup: 'admin' } },
          { path: 'settings', component: CountingLeaf, name: 'admin_settings' },
          { path: 'accounts', component: Pane, name: 'accounts' },
          { path: 'calendars', component: Pane, name: 'admin_calendars' },
          { path: 'moderation', component: Pane, name: 'moderation' },
          { path: 'moderation/reports/:reportId', component: Pane, name: 'moderation_report_detail' },
          { path: 'federation', component: Pane, name: 'federation' },
          { path: 'funding', component: Pane, name: 'funding' },
        ] },
      ] },
      { path: '/policy', component: Pane, name: 'instance-policy' },
      { path: '/auth/logout', component: Pane, name: 'logout' },
    ],
  });
}

describe('settings layout', () => {
  let pinia: Pinia;
  let router: Router;
  let sandbox: sinon.SinonSandbox;
  let wrapper: VueWrapper | null;
  let media: FakeMatchMedia;
  let host: HTMLElement;

  beforeEach(() => {
    // The tree and list page read the shell layout; every mount gets the
    // fake matchMedia, at md+.
    resetShellLayoutForTesting();
    media = installMatchMedia(true);
    pinia = createPinia();
    setActivePinia(pinia);
    sandbox = sinon.createSandbox();
    sandbox.stub(CalendarService.prototype, 'ensureCalendarsLoaded')
      .callsFake(async () => useCalendarStore().calendarInfos);
    sandbox.stub(FundingService.prototype, 'ensureInstanceFundingLoaded')
      .callsFake(async () => useFundingStore().instanceFundingEnabled === true);
    useCalendarStore().setCalendarInfos([
      new CalendarInfo(calendar('o1', 'riverside', 'Riverside Arts'), 'owner'),
      new CalendarInfo(calendar('o2', 'harbour', 'Harbour Hall'), 'owner'),
    ]);
    router = makeRouter();
    calendarParentSetups = 0;
    leafSetups = 0;
    wrapper = null;
    // Attached so focus moves land on document.activeElement.
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    wrapper?.unmount();
    host.remove();
    resetShellLayoutForTesting();
    media.restore();
    sandbox.restore();
  });

  async function mountAt(path: string, isAdmin = false): Promise<VueWrapper> {
    await router.push(path);
    wrapper = mountComponent(App, router, {
      pinia,
      provide: { authn: { isAdmin: () => isAdmin } },
      attachTo: host,
    });
    await flushPromises();
    return wrapper;
  }

  async function go(path: string): Promise<void> {
    await router.push(path);
    await flushPromises();
  }

  it('renders the settings tree, one page header and the routed pane', async () => {
    const w = await mountAt('/settings/account/profile');
    expect(w.find('nav.settings-tree').attributes('aria-label')).toBe('Settings');
    expect(w.findAll('h1')).toHaveLength(1);
    expect(w.find('.settings-layout__content [data-testid="pane"]').exists()).toBe(true);
  });

  it.each([
    ['/settings', 'Settings'],
    ['/settings/account', 'Account'],
    ['/settings/account/profile', 'Profile'],
    ['/settings/calendar/riverside', 'Riverside Arts'],
    ['/settings/calendar/riverside/editors', 'Editors'],
    ['/settings/calendar/unknown', 'Calendar'],
    ['/settings/admin', 'Instance'],
  ])('renders exactly one h1 at %s', async (path, title) => {
    const w = await mountAt(path, true);
    const headings = w.findAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0].text()).toBe(title);
  });

  it('keeps the same h1 element across an index to leaf change', async () => {
    const w = await mountAt('/settings/account');
    const before = w.find('h1').element;
    await go('/settings/account/profile');
    expect(w.find('h1').element).toBe(before);
    expect(w.find('h1').text()).toBe('Profile');

    await go('/settings/calendar/riverside');
    const calendarIndex = w.find('h1').element;
    expect(calendarIndex).toBe(before);
    await go('/settings/calendar/riverside/general');
    expect(w.find('h1').element).toBe(before);
  });

  it('remounts the calendar pane when another calendar is picked', async () => {
    const w = await mountAt('/settings/calendar/riverside/general');
    expect(w.find('[data-testid="calendar-parent"]').attributes('data-mounted-for')).toBe('riverside');
    await go('/settings/calendar/harbour/general');
    expect(w.find('[data-testid="calendar-parent"]').attributes('data-mounted-for')).toBe('harbour');
    expect(calendarParentSetups).toBe(2);
  });

  it('keeps the calendar pane mounted between two leaves of one calendar', async () => {
    await mountAt('/settings/calendar/riverside/general');
    await go('/settings/calendar/riverside/editors');
    await go('/settings/calendar/riverside');
    expect(calendarParentSetups).toBe(1);
  });

  it('keeps the pane mounted between account leaves and remounts it for admin', async () => {
    await mountAt('/settings/account/profile', true);
    await go('/settings/account/security');
    expect(leafSetups).toBe(1);
    await go('/settings/admin/settings');
    expect(leafSetups).toBe(2);
  });

  it('renders no Account or Instance rows in the calendar switcher', async () => {
    const w = await mountAt('/settings/calendar/riverside/general', true);
    await w.find('.settings-page-header button.calendar-switcher').trigger('click');
    await flushPromises();
    expect(w.find('[data-url-name="harbour"]').exists()).toBe(true);
    expect(w.find('[data-testid="switcher-account"]').exists()).toBe(false);
    expect(w.find('[data-testid="switcher-admin"]').exists()).toBe(false);
  });

  it('offers Log out in the tree footer at md+', async () => {
    const w = await mountAt('/settings/account/profile');
    const logOut = w.find('.settings-tree__footer button');
    expect(logOut.text()).toBe('Log out');
    await logOut.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('logout');
  });

  it('links the funding plan back to the account section', async () => {
    useFundingStore().instanceFundingEnabled = true;
    const w = await mountAt('/settings/account/funding');
    expect(w.find('h1').text()).toBe('Funding Plan');
    const back = w.find('.settings-page-header__back');
    expect(back.text()).toBe('Back to Account');
    expect(back.attributes('href')).toBe('/settings/account');
  });

  describe('focus rule', () => {
    const heading = () => document.querySelector('h1');

    it('moves focus to the h1 after a path change in page mode', async () => {
      media.setMatches(false);
      await mountAt('/settings');
      await go('/settings/account');
      expect(document.activeElement).toBe(heading());
      expect(heading()?.textContent).toBe('Account');
    });

    it('moves nothing at md+', async () => {
      await mountAt('/settings');
      await go('/settings/account');
      expect(document.activeElement).toBe(document.body);
    });

    it('moves nothing on initial load', async () => {
      media.setMatches(false);
      const focus = sandbox.spy(HTMLElement.prototype, 'focus');
      await mountAt('/settings/account/profile');
      expect(focus.called).toBe(false);
      expect(document.activeElement).toBe(document.body);
    });

    it('moves nothing on a query-only change', async () => {
      media.setMatches(false);
      await mountAt('/settings/account/profile');
      await go('/settings/account/profile?section=email');
      expect(document.activeElement).toBe(document.body);
    });

    it('moves nothing when only the calendar changes', async () => {
      media.setMatches(false);
      await mountAt('/settings/calendar/riverside/editors');
      await go('/settings/calendar/harbour/editors');
      expect(router.currentRoute.value.params.calendar).toBe('harbour');
      expect(document.activeElement).toBe(document.body);
    });

    it('moves nothing when only the calendar changes on a calendar section', async () => {
      media.setMatches(false);
      await mountAt('/settings/calendar/riverside');
      await go('/settings/calendar/harbour');
      expect(router.currentRoute.value.name).toBe('calendar_management');
      expect(document.activeElement).toBe(document.body);
    });

    it('moves focus when the calendar and the leaf both change', async () => {
      media.setMatches(false);
      await mountAt('/settings/calendar/riverside/editors');
      await go('/settings/calendar/harbour/widget');
      expect(document.activeElement).toBe(heading());
    });

    it('leaves focus to the reports leaf for a destination with a reportId', async () => {
      media.setMatches(false);
      await mountAt('/settings/calendar/riverside/reports');
      await go('/settings/calendar/riverside/reports/9d4b2c1e-6f3a-4c8e-9b1d-2a7e5f0c3b64');
      expect(router.currentRoute.value.name).toBe('calendar_report_detail');
      expect(document.activeElement).toBe(document.body);
    });

    it('moves focus onto the admin report detail, which manages no focus of its own', async () => {
      media.setMatches(false);
      await mountAt('/settings/admin/moderation', true);
      await go('/settings/admin/moderation/reports/9d4b2c1e-6f3a-4c8e-9b1d-2a7e5f0c3b64');
      expect(router.currentRoute.value.name).toBe('moderation_report_detail');
      expect(document.activeElement).toBe(heading());
    });

    it('moves focus once for a redirect chain, on the final route', async () => {
      media.setMatches(false);
      await mountAt('/settings');
      const focus = sandbox.spy(HTMLElement.prototype, 'focus');
      await go('/settings/forward-a');
      expect(router.currentRoute.value.name).toBe('profile');
      expect(focus.callCount).toBe(1);
      expect(focus.firstCall.thisValue).toBe(heading());
      expect(document.activeElement).toBe(heading());
      expect(heading()?.textContent).toBe('Profile');
    });

    it('adds no forward of its own after a guard forward at md+', async () => {
      await mountAt('/settings/account/security');
      const replace = sandbox.spy(router, 'replace');
      await go('/settings/account-index');
      expect(router.currentRoute.value.name).toBe('profile');
      expect(replace.called).toBe(false);
      expect(document.activeElement).toBe(document.body);
    });
  });
});
