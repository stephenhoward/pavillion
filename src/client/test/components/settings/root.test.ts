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
          { path: 'import', component: Pane, name: 'calendar_import' },
          { path: 'widget', component: Pane, name: 'calendar_widget' },
        ] },
        { path: 'account', component: SettingsListPage, name: 'account', meta: { settingsGroup: 'account' } },
        { path: 'account/profile', component: Pane, name: 'profile' },
        { path: 'account/security', component: Pane, name: 'security' },
        { path: 'account/funding', component: Pane, name: 'funding_plan' },
        { path: 'admin', component: Outlet, children: [
          { path: '', component: SettingsListPage, name: 'admin', meta: { settingsGroup: 'admin' } },
          { path: 'settings', component: Pane, name: 'admin_settings' },
          { path: 'accounts', component: Pane, name: 'accounts' },
          { path: 'calendars', component: Pane, name: 'admin_calendars' },
          { path: 'moderation', component: Pane, name: 'moderation' },
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
    wrapper = null;
  });

  afterEach(() => {
    wrapper?.unmount();
    resetShellLayoutForTesting();
    media.restore();
    sandbox.restore();
  });

  async function mountAt(path: string, isAdmin = false): Promise<VueWrapper> {
    await router.push(path);
    wrapper = mountComponent(App, router, {
      pinia,
      provide: { authn: { isAdmin: () => isAdmin } },
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
});
