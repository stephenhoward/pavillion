import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { mountComponent } from '@/client/test/lib/vue';
import AccountCalendars from '@/client/components/logged_in/settings/account-calendars.vue';
import CalendarService from '@/client/service/calendar';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useToast, resetToastState } from '@/client/composables/useToast';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';

const Stub = { template: '<div />' };

const createTestRouter = (): Router => createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/settings/account/calendars', name: 'account_calendars', component: Stub },
    { path: '/settings/calendar/:calendar', name: 'calendar_management', component: Stub },
    { path: '/settings/calendar/:calendar/general', name: 'calendar_general', component: Stub },
    { path: '/settings/calendar/:calendar/widget', name: 'calendar_widget', component: Stub },
  ],
});

/** A calendar whose English name is `name`, or blank when omitted. */
function calendar(id: string, urlName: string, name?: string): Calendar {
  const model = new Calendar(id, urlName);
  if (name) {
    model.content('en').name = name;
  }
  return model;
}

const riverside = calendar('cal-river', 'riverside', 'Riverside Arts');
const coop = calendar('cal-coop', 'coop', 'Food Co-op');
const library = calendar('cal-lib', 'library', 'Library Events');

describe('Account calendars screen', () => {
  const { showModal, close } = HTMLDialogElement.prototype;
  let sandbox: sinon.SinonSandbox;
  let pinia: Pinia;
  let wrapper: VueWrapper | null = null;
  let heading: HTMLElement;

  beforeEach(() => {
    // happy-dom does not implement showModal()/close().
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    sandbox = sinon.createSandbox();
    pinia = createPinia();
    setActivePinia(pinia);
    resetToastState();
    // The settings layout's h1, which the screen falls back to for focus.
    heading = document.createElement('h1');
    heading.className = 'settings-page-header__title';
    heading.tabIndex = -1;
    document.body.appendChild(heading);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    heading.remove();
    sandbox.restore();
    HTMLDialogElement.prototype.showModal = showModal;
    HTMLDialogElement.prototype.close = close;
  });

  /**
   * Mount the screen over `infos`, already loaded into the store; the
   * loader resolves with the store's list, as it does once loaded.
   */
  async function mountWith(infos: CalendarInfo[]) {
    useCalendarStore().setCalendarInfos(infos);
    const ensure = sandbox.stub(CalendarService.prototype, 'ensureCalendarsLoaded').resolves(infos);
    const router = createTestRouter();
    await router.push('/settings/account/calendars');
    await router.isReady();
    wrapper = mountComponent(AccountCalendars, router, {
      pinia,
      attachTo: document.body,
      provide: {
        authn: { isAdmin: () => false },
        site_config: { settings: () => ({ domain: 'pavillion.dev' }) },
      },
      stubs: { CreateCalendarSheet: true, HelpButton: true },
    });
    await flushPromises();
    return { wrapper, router, ensure };
  }

  const rows = (list: VueWrapper) => list.findAll('[data-testid="account-calendar-row"]');

  /** Stub the service's leave so it changes the store the way the real one does. */
  function stubLeave() {
    return sandbox.stub(CalendarService.prototype, 'leaveCalendar').callsFake(async (left: Calendar) => {
      useCalendarStore().removeCalendar(left);
    });
  }

  async function confirmLeave(list: VueWrapper, rowIndex: number) {
    await rows(list)[rowIndex].find('button').trigger('click');
    await list.find('dialog .pill-button').trigger('click');
    await flushPromises();
  }

  it('loads the account\'s calendars on mount', async () => {
    const { ensure } = await mountWith([]);

    expect(ensure.calledOnce).toBe(true);
  });

  it('lists owned calendars, then edited ones, each with its role', async () => {
    const { wrapper: list } = await mountWith([
      new CalendarInfo(coop, 'editor'),
      new CalendarInfo(riverside, 'owner'),
    ]);

    expect(rows(list).map((row) => row.find('a').text())).toEqual(['Riverside Arts', 'Food Co-op']);
    expect(rows(list).map((row) => row.find('.badge').text())).toEqual(['Owner', 'Editor']);
  });

  it('shows the url name for a calendar with no name', async () => {
    const { wrapper: list } = await mountWith([new CalendarInfo(calendar('cal-x', 'unnamed'), 'owner')]);

    expect(rows(list)[0].find('a').text()).toBe('unnamed');
  });

  it('links each calendar to the first settings screen its viewer sees', async () => {
    const { wrapper: list } = await mountWith([
      new CalendarInfo(riverside, 'owner'),
      new CalendarInfo(coop, 'editor'),
    ]);

    expect(rows(list).map((row) => row.find('a').attributes('href'))).toEqual([
      '/settings/calendar/riverside/general',
      '/settings/calendar/coop/widget',
    ]);
  });

  it('offers Leave on editor rows only, named for its calendar', async () => {
    const { wrapper: list } = await mountWith([
      new CalendarInfo(riverside, 'owner'),
      new CalendarInfo(coop, 'editor'),
    ]);

    expect(rows(list)[0].find('button').exists()).toBe(false);
    const leave = rows(list)[1].find('button');
    expect(leave.text()).toBe('Leave');
    expect(leave.attributes('aria-label')).toBe('Leave Food Co-op');
    expect(leave.attributes('aria-haspopup')).toBe('dialog');
    expect(leave.attributes('type')).toBe('button');
  });

  it('asks for confirmation before leaving, and cancelling leaves nothing', async () => {
    const leave = stubLeave();
    const { wrapper: list } = await mountWith([new CalendarInfo(coop, 'editor')]);

    await rows(list)[0].find('button').trigger('click');
    const dialog = list.find('dialog');
    expect(dialog.exists()).toBe(true);
    expect(dialog.text()).toContain('Are you sure you want to leave this calendar?');

    await list.find('dialog .btn-ghost').trigger('click');
    expect(list.find('dialog').exists()).toBe(false);
    expect(leave.called).toBe(false);
  });

  it('leaves on confirm, drops the row and stays on the screen', async () => {
    const leave = stubLeave();
    const { wrapper: list, router } = await mountWith([
      new CalendarInfo(riverside, 'owner'),
      new CalendarInfo(coop, 'editor'),
      new CalendarInfo(library, 'editor'),
    ]);

    await confirmLeave(list, 1);

    expect(leave.calledOnce).toBe(true);
    expect(leave.firstCall.args[0].id).toBe('cal-coop');
    expect(rows(list).map((row) => row.find('a').text())).toEqual(['Riverside Arts', 'Library Events']);
    expect(list.find('dialog').exists()).toBe(false);
    expect(router.currentRoute.value.name).toBe('account_calendars');
    expect(useToast().toasts.value.map((toast) => toast.message)).toEqual(['You left Food Co-op.']);
  });

  it('moves focus to the link of the row that took the left row\'s place', async () => {
    stubLeave();
    const { wrapper: list } = await mountWith([
      new CalendarInfo(coop, 'editor'),
      new CalendarInfo(library, 'editor'),
    ]);

    await confirmLeave(list, 0);

    expect(document.activeElement).toBe(rows(list)[0].find('a').element);
  });

  it('moves focus to the page heading when the left row was the last', async () => {
    stubLeave();
    const { wrapper: list } = await mountWith([
      new CalendarInfo(riverside, 'owner'),
      new CalendarInfo(coop, 'editor'),
    ]);

    await confirmLeave(list, 1);

    expect(document.activeElement).toBe(heading);
  });

  it('keeps the row and reports the failure when the server refuses', async () => {
    sandbox.stub(console, 'error');
    sandbox.stub(CalendarService.prototype, 'leaveCalendar').rejects(new CalendarEditorPermissionError());
    const { wrapper: list } = await mountWith([new CalendarInfo(coop, 'editor')]);

    await confirmLeave(list, 0);

    expect(rows(list)).toHaveLength(1);
    expect(useToast().toasts.value.map((toast) => toast.message)).toEqual(['Failed to leave calendar']);
  });

  it('opens the create-calendar sheet from its Create button, onto the new calendar\'s settings', async () => {
    const { wrapper: list } = await mountWith([new CalendarInfo(riverside, 'owner')]);

    expect(list.findComponent({ name: 'CreateCalendarSheet' }).exists()).toBe(false);
    await list.find('[data-testid="account-calendars-create"]').trigger('click');

    const sheet = list.findComponent({ name: 'CreateCalendarSheet' });
    expect(sheet.exists()).toBe(true);
    expect(sheet.props('routeName')).toBe('calendar_management');
  });

  it('shows an empty state with the Create button when the account has no calendars', async () => {
    const { wrapper: list } = await mountWith([]);

    expect(rows(list)).toHaveLength(0);
    expect(list.find('.empty-state').exists()).toBe(true);
    expect(list.find('.empty-state [data-testid="account-calendars-create"]').exists()).toBe(true);
  });

  it('shows an error, not the empty state, when the calendars fail to load', async () => {
    sandbox.stub(console, 'error');
    const router = createTestRouter();
    sandbox.stub(CalendarService.prototype, 'ensureCalendarsLoaded').rejects(new Error('network'));
    await router.push('/settings/account/calendars');
    wrapper = mountComponent(AccountCalendars, router, {
      pinia,
      provide: { authn: { isAdmin: () => false } },
      stubs: { CreateCalendarSheet: true, HelpButton: true },
    });
    await flushPromises();

    expect(wrapper.find('[role="alert"]').text()).toBe('Your calendars could not be loaded.');
    expect(wrapper.find('.empty-state').exists()).toBe(false);
  });
});
