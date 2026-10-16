import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { flushPromises, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import { createMemoryHistory, createRouter, Router, useRoute } from 'vue-router';
import { mountComponent } from '@/client/test/lib/vue';
import SettingsRoot from '@/client/components/logged_in/settings/root.vue';
import CalendarManagementRoot from '@/client/components/logged_in/calendar-management/root.vue';
import CalendarService from '@/client/service/calendar';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';

const App = { template: '<RouterView />' };
const Pane = { template: '<div data-testid="pane" />' };
// Captures the calendar param once, at setup, as the management view does.
const ManagementPane = {
  setup() {
    return { mountedFor: useRoute().params.calendar };
  },
  template: '<div data-testid="pane">{{ mountedFor }}</div>',
};

function calendar(id: string, urlName: string, name: string): Calendar {
  const cal = new Calendar(id, urlName);
  cal.content('en').name = name;
  return cal;
}

function makeRouter(management: object = ManagementPane): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/calendar/:calendar', component: Pane, name: 'calendar' },
      { path: '/settings', component: SettingsRoot, children: [
        { path: 'calendar/:calendar', component: management, name: 'calendar_management' },
        { path: 'account', component: Pane, name: 'profile' },
        { path: 'account/funding', component: Pane, name: 'funding_plan' },
        { path: 'admin', component: { template: '<RouterView />' }, name: 'admin', children: [
          { path: 'settings', component: Pane, name: 'admin_settings' },
          { path: 'moderation', component: Pane, name: 'moderation' },
        ] },
      ] },
    ],
  });
}

describe('settings root', () => {
  let pinia: Pinia;
  let router: Router;
  let sandbox: sinon.SinonSandbox;
  let wrapper: VueWrapper | null;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    sandbox = sinon.createSandbox();
    sandbox.stub(CalendarService.prototype, 'ensureCalendarsLoaded')
      .callsFake(async () => useCalendarStore().calendarInfos);
    useCalendarStore().setCalendarInfos([
      new CalendarInfo(calendar('o1', 'riverside', 'Riverside Arts'), 'owner'),
      new CalendarInfo(calendar('e1', 'shared', 'Shared Events'), 'editor'),
    ]);
    router = makeRouter();
    wrapper = null;
  });

  afterEach(() => {
    wrapper?.unmount();
    sandbox.restore();
  });

  async function mountAt(
    path: string,
    isAdmin: boolean,
    options: { stubs?: Record<string, unknown>; attachTo?: Element } = {},
  ): Promise<VueWrapper> {
    await router.push(path);
    wrapper = mountComponent(App, router, {
      pinia,
      provide: { authn: { isAdmin: () => isAdmin } },
      ...options,
    });
    await flushPromises();
    return wrapper;
  }

  const trigger = (w: VueWrapper) => w.find('header h1 button.calendar-switcher');

  it('labels the trigger with the calendar name on a calendar pane', async () => {
    const w = await mountAt('/settings/calendar/riverside', false);
    expect(trigger(w).text()).toContain('Riverside Arts');
    expect(trigger(w).attributes('aria-label')).toBe('Switch settings: Riverside Arts');
    expect(w.find('[data-testid="pane"]').exists()).toBe(true);
  });

  it('renders the reduced management view for an edited calendar', async () => {
    router = makeRouter(CalendarManagementRoot);
    const w = await mountAt('/settings/calendar/shared', false, {
      stubs: {
        EditorsTab: true,
        SettingsTab: true,
        WidgetTab: true,
        ReportsDashboard: true,
        ReportDetail: true,
        ImportSourcesSection: true,
      },
    });
    expect(trigger(w).text()).toContain('Shared Events');
    expect(w.find('#editors-tab').exists()).toBe(true);
    expect(w.find('#widget-tab').exists()).toBe(true);
    expect(w.find('#settings-tab').exists()).toBe(false);
    expect(w.find('#reports-tab').exists()).toBe(false);
    expect(w.find('.error-message').exists()).toBe(false);
    expect(w.find('.empty-state').exists()).toBe(false);
  });

  it('labels the trigger Account on the account panes', async () => {
    const w = await mountAt('/settings/account', false);
    expect(trigger(w).text()).toContain('Account');
    expect(trigger(w).attributes('aria-label')).toBe('Switch settings: Account');
    await router.push('/settings/account/funding');
    await flushPromises();
    expect(trigger(w).text()).toContain('Account');
  });

  it('labels the trigger Instance administration on every admin pane', async () => {
    const w = await mountAt('/settings/admin/settings', true);
    expect(trigger(w).text()).toContain('Instance administration');
    await router.push('/settings/admin/moderation');
    await flushPromises();
    expect(trigger(w).text()).toContain('Instance administration');
  });

  it('offers the Instance administration row only to admins', async () => {
    let w = await mountAt('/settings/account', false);
    await trigger(w).trigger('click');
    expect(w.find('[data-testid="switcher-account"]').exists()).toBe(true);
    expect(w.find('[data-testid="switcher-admin"]').exists()).toBe(false);
    w.unmount();

    w = await mountAt('/settings/account', true);
    await trigger(w).trigger('click');
    expect(w.find('[data-testid="switcher-admin"] a').attributes('href')).toBe('/settings/admin/settings');
  });

  it('marks the active settings row current and renders it inert', async () => {
    const w = await mountAt('/settings/account', true);
    await trigger(w).trigger('click');
    const account = w.find('[data-testid="switcher-account"]');
    expect(account.attributes('aria-current')).toBe('true');
    expect(account.find('a').exists()).toBe(false);
    expect(account.find('.sr-only').text()).toBe('Current');
    expect(w.find('[data-testid="switcher-admin"]').attributes('aria-current')).toBeUndefined();
    expect(w.find('[aria-current="true"][data-testid="switcher-row"]').exists()).toBe(false);
  });

  it('marks the Instance administration row current on an admin pane', async () => {
    const w = await mountAt('/settings/admin/settings', true);
    await trigger(w).trigger('click');
    const admin = w.find('[data-testid="switcher-admin"]');
    expect(admin.attributes('aria-current')).toBe('true');
    expect(admin.find('a').exists()).toBe(false);
    const account = w.find('[data-testid="switcher-account"]');
    expect(account.attributes('aria-current')).toBeUndefined();
    expect(account.find('a').attributes('href')).toBe('/settings/account');
  });

  it('marks the calendar row current on its management pane', async () => {
    const w = await mountAt('/settings/calendar/riverside', true);
    await trigger(w).trigger('click');
    expect(w.find('[data-url-name="riverside"]').attributes('aria-current')).toBe('true');
    expect(w.find('[data-testid="switcher-account"]').attributes('aria-current')).toBeUndefined();
  });

  it('opens a picked calendar in calendar management', async () => {
    const w = await mountAt('/settings/account', false);
    await trigger(w).trigger('click');
    await w.find('[data-url-name="shared"] a').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/settings/calendar/shared');
    expect(trigger(w).text()).toContain('Shared Events');
  });

  it('remounts the management pane when another calendar is picked', async () => {
    const w = await mountAt('/settings/calendar/riverside', false);
    expect(w.find('[data-testid="pane"]').text()).toBe('riverside');
    await trigger(w).trigger('click');
    await w.find('[data-url-name="shared"] a').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="pane"]').text()).toBe('shared');
  });

  it('closes the sheet when a settings row is picked', async () => {
    const w = await mountAt('/settings/calendar/riverside', true);
    await trigger(w).trigger('click');
    await w.find('[data-testid="switcher-account"] a').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/settings/account');
    expect(w.find('[data-testid="switcher-account"]').exists()).toBe(false);
    expect(trigger(w).attributes('aria-expanded')).toBe('false');
  });

  describe('focus return', () => {
    const { showModal, close } = HTMLDialogElement.prototype;

    beforeEach(() => {
      // happy-dom does not implement showModal()/close(). Polyfill just enough
      // for the real sheet's useDialog to open, so focus really leaves the
      // trigger and the test proves it comes back.
      HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
      HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    });

    afterEach(() => {
      HTMLDialogElement.prototype.showModal = showModal;
      HTMLDialogElement.prototype.close = close;
    });

    it('returns focus to the trigger after a settings row is picked', async () => {
      const w = await mountAt('/settings/calendar/riverside', false, { attachTo: document.body });
      const triggerEl = trigger(w).element as HTMLButtonElement;
      triggerEl.focus();
      await trigger(w).trigger('click');
      await flushPromises();
      // useDialog moves initial focus into the sheet on a zero-delay timer.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(document.activeElement).not.toBe(triggerEl);

      await w.find('[data-testid="switcher-account"] a').trigger('click');
      await flushPromises();

      expect(router.currentRoute.value.name).toBe('profile');
      expect(document.activeElement).toBe(trigger(w).element);
    });
  });
});
