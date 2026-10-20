import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import sinon from 'sinon';
import { flushPromises, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { mountComponent } from '@/client/test/lib/vue';
import { installMatchMedia, type FakeMatchMedia } from '@/client/test/lib/match-media';
import { resetShellLayoutForTesting } from '@/client/composables/useShellLayout';
import SettingsListPage from '@/client/components/logged_in/settings/list-page.vue';
import CalendarService from '@/client/service/calendar';
import FundingService from '@/client/service/funding';
import { settingsIndexTarget, type SettingsForwardDeps } from '@/client/service/settings-guards';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useFundingStore } from '@/client/stores/fundingStore';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';
import type { SettingsGroup } from '@/client/components/logged_in/settings/nav-items';

const Stub = { template: '<div />' };

const createTestRouter = (): Router => createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/settings', name: 'settings', component: Stub, meta: { settingsGroup: 'root' } },
    { path: '/settings/calendar/:calendar', name: 'calendar_management', component: Stub, meta: { settingsGroup: 'calendar' } },
    { path: '/settings/calendar/:calendar/general', name: 'calendar_general', component: Stub },
    { path: '/settings/calendar/:calendar/editors', name: 'calendar_editors', component: Stub },
    { path: '/settings/calendar/:calendar/reports', name: 'calendar_reports', component: Stub },
    { path: '/settings/calendar/:calendar/import', name: 'calendar_import', component: Stub },
    { path: '/settings/calendar/:calendar/widget', name: 'calendar_widget', component: Stub },
    { path: '/settings/account', name: 'account', component: Stub, meta: { settingsGroup: 'account' } },
    { path: '/settings/account/profile', name: 'profile', component: Stub },
    { path: '/settings/account/security', name: 'security', component: Stub },
    { path: '/settings/account/funding', name: 'funding_plan', component: Stub },
    { path: '/settings/admin', name: 'admin', component: Stub, meta: { settingsGroup: 'admin' } },
    { path: '/settings/admin/settings', name: 'admin_settings', component: Stub },
    { path: '/settings/admin/accounts', name: 'accounts', component: Stub },
    { path: '/settings/admin/calendars', name: 'admin_calendars', component: Stub },
    { path: '/settings/admin/moderation', name: 'moderation', component: Stub },
    { path: '/settings/admin/federation', name: 'federation', component: Stub },
    { path: '/settings/admin/funding', name: 'funding', component: Stub },
    { path: '/policy', name: 'instance-policy', component: Stub },
    { path: '/auth/logout', name: 'logout', component: Stub },
  ],
});

function calendar(id: string, urlName: string, name: string): Calendar {
  const cal = new Calendar(id, urlName);
  cal.content('en').name = name;
  return cal;
}

const owned = () => new CalendarInfo(calendar('o1', 'riverside', 'Riverside Arts'), 'owner');
const edited = () => new CalendarInfo(calendar('e1', 'shared', 'Shared Events'), 'editor');

describe('settings list page', () => {
  let pinia: Pinia;
  let sandbox: sinon.SinonSandbox;
  let loadCalendars: sinon.SinonStub;
  let loadFunding: sinon.SinonStub;
  let media: FakeMatchMedia;
  let router: Router;
  let replace: MockInstance;
  let wrapper: VueWrapper | null;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    sandbox = sinon.createSandbox();
    loadCalendars = sandbox.stub(CalendarService.prototype, 'ensureCalendarsLoaded')
      .callsFake(async () => useCalendarStore().calendarInfos);
    loadFunding = sandbox.stub(FundingService.prototype, 'ensureInstanceFundingLoaded')
      .callsFake(async () => useFundingStore().instanceFundingEnabled === true);
    resetShellLayoutForTesting();
    media = installMatchMedia(false);
    wrapper = null;
  });

  afterEach(() => {
    wrapper?.unmount();
    resetShellLayoutForTesting();
    media.restore();
    sandbox.restore();
    vi.restoreAllMocks();
  });

  async function mountAt(
    path: string,
    options: { isAdmin?: boolean; calendars?: CalendarInfo[]; fundingEnabled?: boolean } = {},
  ): Promise<VueWrapper> {
    useCalendarStore().setCalendarInfos(options.calendars ?? [owned()]);
    useFundingStore().instanceFundingEnabled = options.fundingEnabled ?? false;
    router = createTestRouter();
    await router.push(path);
    await router.isReady();
    replace = vi.spyOn(router, 'replace');
    wrapper = mountComponent(SettingsListPage, router, {
      pinia,
      provide: { authn: { isAdmin: () => options.isAdmin ?? false } },
    });
    await flushPromises();
    return wrapper;
  }

  /** The shared target, computed the way the guard computes it. */
  function sharedTarget(group: SettingsGroup, calendarParam: unknown, isAdmin: boolean) {
    const deps: SettingsForwardDeps = {
      loadCalendars: () => new CalendarService().ensureCalendarsLoaded(),
      isAdmin: () => isAdmin,
      loadInstanceFunding: () => new FundingService().ensureInstanceFundingLoaded(),
    };
    return settingsIndexTarget(group, calendarParam, deps);
  }

  const rowLabels = (w: VueWrapper) => w.findAll('li').map((li) => li.text());

  describe('resize-up forward', () => {
    it.each([
      { label: 'calendar owner', path: '/settings/calendar/riverside', group: 'calendar', param: 'riverside',
        calendars: [owned()], isAdmin: false, expected: { name: 'calendar_general', params: { calendar: 'riverside' } } },
      { label: 'calendar editor', path: '/settings/calendar/shared', group: 'calendar', param: 'shared',
        calendars: [edited()], isAdmin: false, expected: { name: 'calendar_editors', params: { calendar: 'shared' } } },
      { label: 'root', path: '/settings', group: 'root', param: undefined,
        calendars: [owned()], isAdmin: false, expected: { name: 'calendar_general', params: { calendar: 'riverside' } } },
      { label: 'account', path: '/settings/account', group: 'account', param: undefined,
        calendars: [owned()], isAdmin: false, expected: { name: 'profile' } },
      { label: 'admin', path: '/settings/admin', group: 'admin', param: undefined,
        calendars: [owned()], isAdmin: true, expected: { name: 'admin_settings' } },
    ] as const)('replaces once with the shared target ($label)', async ({ path, group, param, calendars, isAdmin, expected }) => {
      await mountAt(path, { calendars: [...calendars], isAdmin });

      media.setMatches(true);
      await flushPromises();

      const target = await sharedTarget(group, param, isAdmin);
      expect(target).toEqual(expected);
      expect(replace).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledWith(target);
      expect(router.currentRoute.value.name).toBe(expected.name);
    });

    it('replaces only once when the query reports a match twice', async () => {
      await mountAt('/settings/account');

      media.setMatches(true);
      await flushPromises();
      media.setMatches(true);
      await flushPromises();

      expect(replace).toHaveBeenCalledTimes(1);
    });

    it('does not forward an unresolved calendar', async () => {
      await mountAt('/settings/calendar/nope');

      media.setMatches(true);
      await flushPromises();

      expect(replace).not.toHaveBeenCalled();
      expect(router.currentRoute.value.path).toBe('/settings/calendar/nope');
    });

    it('does not forward when the calendar load fails', async () => {
      await mountAt('/settings/calendar/riverside');
      loadCalendars.rejects(new Error('offline'));

      media.setMatches(true);
      await flushPromises();

      expect(replace).not.toHaveBeenCalled();
    });

    it('does not forward on mount when already at md+ (the guard owns that)', async () => {
      media.restore();
      resetShellLayoutForTesting();
      media = installMatchMedia(true);

      await mountAt('/settings/account');

      expect(replace).not.toHaveBeenCalled();
    });
  });

  describe('resize down', () => {
    it('neither replaces nor navigates', async () => {
      media.restore();
      resetShellLayoutForTesting();
      media = installMatchMedia(true);
      await mountAt('/settings/account');
      const push = vi.spyOn(router, 'push');

      media.setMatches(false);
      await flushPromises();

      expect(replace).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
      expect(router.currentRoute.value.path).toBe('/settings/account');
    });
  });

  describe('after unmount', () => {
    it('stops forwarding', async () => {
      const w = await mountAt('/settings/account');
      w.unmount();
      wrapper = null;

      media.setMatches(true);
      await flushPromises();

      expect(replace).not.toHaveBeenCalled();
    });

    it('drops a forward that resolves after unmount', async () => {
      const w = await mountAt('/settings/account');
      let release!: () => void;
      loadCalendars.callsFake(() => new Promise((resolve) => {
        release = () => resolve(useCalendarStore().calendarInfos);
      }));

      media.setMatches(true);
      await flushPromises();
      w.unmount();
      wrapper = null;
      release();
      await flushPromises();

      expect(replace).not.toHaveBeenCalled();
    });
  });

  describe('rendering', () => {
    it('is a nav landmark labelled Settings with its list in page mode', async () => {
      const w = await mountAt('/settings/account');
      expect(w.element.tagName).toBe('NAV');
      expect(w.attributes('aria-label')).toBe('Settings');
      expect(w.find('ul.settings-nav').classes('settings-nav--page')).toBe(true);
    });

    it('renders the root rows, a Log out button and the policy link', async () => {
      const w = await mountAt('/settings', { isAdmin: true });
      expect(rowLabels(w)).toEqual(['Calendar', 'Account', 'Instance', 'Log out']);
      expect(w.find('.settings-nav__logout button').text()).toBe('Log out');
      expect(w.find('.settings-list-page__footer .policy-link').exists()).toBe(true);
    });

    it('puts the policy link on the root list only', async () => {
      const w = await mountAt('/settings/account');
      expect(w.find('.policy-link').exists()).toBe(false);
    });

    it('lists the calendar leaves the viewer may see', async () => {
      const w = await mountAt('/settings/calendar/shared', { calendars: [owned(), edited()] });
      expect(rowLabels(w)).toEqual(['Editors', 'Widget']);
    });

    it('omits Funding Plan from the account list when funding is off', async () => {
      const w = await mountAt('/settings/account', { fundingEnabled: false });
      expect(rowLabels(w)).toEqual(['Profile', 'Security']);
    });

    it('renders no list for an unresolved calendar and never echoes the param', async () => {
      const w = await mountAt('/settings/calendar/nope');
      expect(w.find('ul').exists()).toBe(false);
      expect(w.html()).not.toContain('nope');
    });

    it('lists the Instance rows only to an admin', async () => {
      const w = await mountAt('/settings/admin', { isAdmin: false });
      expect(w.find('ul').exists()).toBe(false);
    });

    it('loads calendars and the funding flag on mount', async () => {
      loadCalendars.callsFake(async () => {
        useCalendarStore().setCalendarInfos([owned()]);
        return useCalendarStore().calendarInfos;
      });
      loadFunding.callsFake(async () => {
        useFundingStore().instanceFundingEnabled = true;
        return true;
      });
      const w = await mountAt('/settings', { calendars: [] });

      expect(loadCalendars.called).toBe(true);
      expect(loadFunding.called).toBe(true);
      expect(rowLabels(w)).toEqual(['Calendar', 'Account', 'Log out']);
      await router.push('/settings/account');
      await flushPromises();
      expect(rowLabels(w)).toEqual(['Profile', 'Security', 'Funding Plan']);
    });
  });
});
