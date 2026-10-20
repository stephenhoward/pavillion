import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { flushPromises, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { mountComponent } from '@/client/test/lib/vue';
import SettingsTree from '@/client/components/logged_in/settings/tree.vue';
import CalendarService from '@/client/service/calendar';
import FundingService from '@/client/service/funding';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useFundingStore } from '@/client/stores/fundingStore';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';

const Stub = { template: '<div />' };

const createTestRouter = (): Router => createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/settings/calendar/:calendar', name: 'calendar_management', component: Stub },
    { path: '/settings/calendar/:calendar/general', name: 'calendar_general', component: Stub },
    { path: '/settings/calendar/:calendar/editors', name: 'calendar_editors', component: Stub },
    { path: '/settings/calendar/:calendar/reports', name: 'calendar_reports', component: Stub },
    { path: '/settings/calendar/:calendar/import', name: 'calendar_import', component: Stub },
    { path: '/settings/calendar/:calendar/widget', name: 'calendar_widget', component: Stub },
    { path: '/settings/account/profile', name: 'profile', component: Stub },
    { path: '/settings/account/security', name: 'security', component: Stub },
    { path: '/settings/account/funding', name: 'funding_plan', component: Stub },
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

describe('settings tree', () => {
  let pinia: Pinia;
  let sandbox: sinon.SinonSandbox;
  let loadCalendars: sinon.SinonStub;
  let loadFunding: sinon.SinonStub;
  let wrapper: VueWrapper | null;
  let host: HTMLElement | null;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    sandbox = sinon.createSandbox();
    loadCalendars = sandbox.stub(CalendarService.prototype, 'ensureCalendarsLoaded')
      .callsFake(async () => useCalendarStore().calendarInfos);
    loadFunding = sandbox.stub(FundingService.prototype, 'ensureInstanceFundingLoaded')
      .callsFake(async () => useFundingStore().instanceFundingEnabled === true);
    wrapper = null;
    host = null;
  });

  afterEach(() => {
    wrapper?.unmount();
    host?.remove();
    sandbox.restore();
  });

  async function mountAt(
    path: string,
    options: { isAdmin?: boolean; calendars?: CalendarInfo[]; fundingEnabled?: boolean; attach?: boolean } = {},
  ): Promise<VueWrapper> {
    useCalendarStore().setCalendarInfos(options.calendars ?? [
      new CalendarInfo(calendar('o1', 'riverside', 'Riverside Arts'), 'owner'),
    ]);
    useFundingStore().instanceFundingEnabled = options.fundingEnabled ?? false;
    const router = createTestRouter();
    await router.push(path);
    await router.isReady();
    if (options.attach) {
      host = document.createElement('div');
      document.body.appendChild(host);
    }
    wrapper = mountComponent(SettingsTree, router, {
      pinia,
      provide: { authn: { isAdmin: () => options.isAdmin ?? false } },
      ...(host ? { attachTo: host } : {}),
    });
    await flushPromises();
    return wrapper;
  }

  const groups = (w: VueWrapper) => w.findAll('[role="group"]');

  const group = (w: VueWrapper, title: string) => groups(w)
    .find((candidate) => candidate.find('.settings-tree__heading').text() === title);

  const rows = (w: VueWrapper, title: string) => group(w, title)?.findAll('li').map((li) => li.text()) ?? null;

  it('is a nav landmark labelled Settings', async () => {
    const w = await mountAt('/settings/account/profile');
    expect(w.element.tagName).toBe('NAV');
    expect(w.attributes('aria-label')).toBe('Settings');
  });

  it('names each group by its label, without adding landmarks or headings', async () => {
    const w = await mountAt('/settings/account/profile', { isAdmin: true });
    const named = groups(w);
    expect(named.map((g) => g.find('.settings-tree__heading').text())).toEqual(['Calendar', 'Account', 'Instance']);
    for (const g of named) {
      const label = g.find('.settings-tree__heading');
      expect(label.attributes('id')).toBeTruthy();
      expect(g.attributes('aria-labelledby')).toBe(label.attributes('id'));
    }
    expect(w.findAll('section, h1, h2, h3, h4, h5, h6')).toHaveLength(0);
  });

  it('renders every list in sidebar mode', async () => {
    const w = await mountAt('/settings/account/profile', { isAdmin: true });
    const lists = w.findAll('ul.settings-nav');
    expect(lists).toHaveLength(4);
    expect(lists.every((list) => list.classes('settings-nav--sidebar'))).toBe(true);
  });

  it('loads calendars and the funding flag on mount', async () => {
    loadCalendars.callsFake(async () => {
      useCalendarStore().setCalendarInfos([
        new CalendarInfo(calendar('o1', 'riverside', 'Riverside Arts'), 'owner'),
      ]);
      return useCalendarStore().calendarInfos;
    });
    const w = await mountAt('/settings/account/profile', { calendars: [] });

    expect(loadCalendars.calledOnce).toBe(true);
    expect(loadFunding.calledOnce).toBe(true);
    expect(rows(w, 'Calendar')).toEqual(['General', 'Editors', 'Reports', 'Import', 'Widget']);
  });

  it('opens with a skip button that focuses the page heading', async () => {
    const heading = document.createElement('h1');
    heading.className = 'settings-page-header__title';
    heading.tabIndex = -1;
    document.body.appendChild(heading);
    try {
      const w = await mountAt('/settings/account/profile', { attach: true });
      const focusable = w.findAll('a, button');
      expect(focusable[0].element.tagName).toBe('BUTTON');
      expect(focusable[0].text()).toBe('Skip to settings content');
      expect(focusable[0].attributes('href')).toBeUndefined();

      await focusable[0].trigger('click');
      expect(document.activeElement).toBe(heading);
    }
    finally {
      heading.remove();
    }
  });

  it('lists only the member-visible leaves for an edited calendar', async () => {
    const w = await mountAt('/settings/account/profile', {
      calendars: [new CalendarInfo(calendar('e1', 'shared', 'Shared Events'), 'editor')],
    });
    expect(rows(w, 'Calendar')).toEqual(['Editors', 'Widget']);
  });

  it('omits the Calendar group when the viewer has no calendar', async () => {
    const w = await mountAt('/settings/account/profile', { calendars: [] });
    expect(group(w, 'Calendar')).toBeUndefined();
  });

  it('shows Funding Plan only when instance funding is enabled', async () => {
    const off = await mountAt('/settings/account/profile', { fundingEnabled: false });
    expect(rows(off, 'Account')).toEqual(['Profile', 'Security']);
    off.unmount();
    wrapper = null;

    const on = await mountAt('/settings/account/profile', { fundingEnabled: true });
    expect(rows(on, 'Account')).toEqual(['Profile', 'Security', 'Funding Plan']);
  });

  it('shows the Instance group only to an admin', async () => {
    const member = await mountAt('/settings/account/profile', { isAdmin: false });
    expect(group(member, 'Instance')).toBeUndefined();
    member.unmount();
    wrapper = null;

    const admin = await mountAt('/settings/account/profile', { isAdmin: true });
    expect(rows(admin, 'Instance')).toEqual(['General', 'Accounts', 'Calendars', 'Moderation', 'Federation', 'Funding']);
  });

  it('addresses the current calendar, never an unresolvable route param', async () => {
    const w = await mountAt('/settings/calendar/nope/general');
    expect(rows(w, 'Calendar')).toEqual(['General', 'Editors', 'Reports', 'Import', 'Widget']);
    const hrefs = group(w, 'Calendar')!.findAll('a').map((a) => a.attributes('href'));
    expect(hrefs.every((href) => href?.startsWith('/settings/calendar/riverside/'))).toBe(true);
    expect(w.html()).not.toContain('nope');
  });

  it('puts Log out as a button in the footer', async () => {
    const w = await mountAt('/settings/account/profile');
    const footer = w.find('.settings-tree__footer');
    const logout = footer.find('button');
    expect(logout.text()).toBe('Log out');
    expect(footer.find('.policy-link').exists()).toBe(true);
  });
});
