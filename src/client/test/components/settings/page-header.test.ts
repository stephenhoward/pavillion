import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { flushPromises, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { mountComponent } from '@/client/test/lib/vue';
import PageHeader from '@/client/components/logged_in/settings/page-header.vue';
import CalendarSwitcher from '@/client/components/logged_in/calendar-switcher/CalendarSwitcher.vue';
import { focusSettingsHeading } from '@/client/components/logged_in/settings/heading-focus';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';

const App = { components: { PageHeader }, template: '<PageHeader /><RouterView />' };
const Pane = { template: '<div data-testid="pane" />' };
const Outlet = { template: '<RouterView />' };

// The settings subtree with the names and index meta the header reads.
const routes: RouteRecordRaw[] = [
  { path: '/settings', component: Outlet, children: [
    { path: '', name: 'settings', component: Pane, meta: { settingsGroup: 'root' } },
    { path: 'calendar/:calendar', component: Outlet, children: [
      { path: '', name: 'calendar_management', component: Pane, meta: { settingsGroup: 'calendar' } },
      { path: 'general', name: 'calendar_general', component: Pane },
      { path: 'editors', name: 'calendar_editors', component: Pane },
      { path: 'reports', name: 'calendar_reports', component: Pane },
      { path: 'reports/:reportId', name: 'calendar_report_detail', component: Pane },
      { path: 'widget', name: 'calendar_widget', component: Pane },
    ] },
    { path: 'account', name: 'account', component: Pane, meta: { settingsGroup: 'account' } },
    { path: 'account/profile', name: 'profile', component: Pane },
    { path: 'account/security', name: 'security', component: Pane },
    { path: 'account/funding', name: 'funding_plan', component: Pane },
    { path: 'admin', component: Outlet, children: [
      { path: '', name: 'admin', component: Pane, meta: { settingsGroup: 'admin' } },
      { path: 'settings', name: 'admin_settings', component: Pane },
      { path: 'moderation/settings', name: 'moderation_settings', component: Pane },
    ] },
  ] },
];

function calendar(id: string, urlName: string, name: string): Calendar {
  const cal = new Calendar(id, urlName);
  cal.content('en').name = name;
  return cal;
}

describe('settings page header', () => {
  let pinia: Pinia;
  let router: Router;
  let wrapper: VueWrapper | null;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    useCalendarStore().setCalendarInfos([
      new CalendarInfo(calendar('o1', 'riverside', 'Riverside Arts'), 'owner'),
      new CalendarInfo(calendar('e1', 'shared', 'Shared Events'), 'editor'),
    ]);
    router = createRouter({ history: createMemoryHistory(), routes });
    document.title = '';
    wrapper = null;
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  async function mountAt(path: string, options: { attachTo?: Element } = {}): Promise<VueWrapper> {
    await router.push(path);
    wrapper = mountComponent(App, router, { pinia, ...options });
    await flushPromises();
    return wrapper;
  }

  async function navigate(path: string): Promise<void> {
    await router.push(path);
    await flushPromises();
  }

  const header = (w: VueWrapper) => w.find('.settings-page-header');
  const heading = (w: VueWrapper) => w.find('h1.settings-page-header__title');
  const backLink = (w: VueWrapper) => w.find('a.settings-back-link');

  describe('back link', () => {
    it.each([
      ['a section', '/settings/account', '/settings', 'Back to Settings'],
      ['the calendar section', '/settings/calendar/riverside', '/settings', 'Back to Settings'],
      ['a calendar leaf', '/settings/calendar/riverside/editors', '/settings/calendar/riverside', 'Back to Riverside Arts'],
      ['an account leaf', '/settings/account/security', '/settings/account', 'Back to Account'],
      ['an admin leaf', '/settings/admin/settings', '/settings/admin', 'Back to Instance'],
      ['report detail', '/settings/calendar/riverside/reports/abc', '/settings/calendar/riverside', 'Back to Riverside Arts'],
      ['a moderation sub-page', '/settings/admin/moderation/settings', '/settings/admin', 'Back to Instance'],
    ])('on %s targets its parent', async (_case, path, href, text) => {
      const w = await mountAt(path);
      expect(backLink(w).attributes('href')).toBe(href);
      expect(backLink(w).text()).toBe(text);
    });

    it('targets the section on a cold load straight to a leaf', async () => {
      const w = await mountAt('/settings/account/funding');
      expect(backLink(w).attributes('href')).toBe('/settings/account');
    });

    it('derives the target from the route, not from where the visitor came from', async () => {
      const w = await mountAt('/settings/account/profile');
      await navigate('/settings/calendar/shared/widget');
      expect(backLink(w).attributes('href')).toBe('/settings/calendar/shared');
      expect(backLink(w).text()).toBe('Back to Shared Events');
    });

    it('is absent on the settings root', async () => {
      const w = await mountAt('/settings');
      expect(backLink(w).exists()).toBe(false);
    });

    it('hides its chevron from assistive technology', async () => {
      const w = await mountAt('/settings/account/profile');
      const icon = backLink(w).find('svg');
      expect(icon.exists()).toBe(true);
      expect(icon.attributes('aria-hidden')).toBe('true');
    });
  });

  describe('heading', () => {
    it.each([
      ['/settings', 'Settings'],
      ['/settings/account', 'Account'],
      ['/settings/admin', 'Instance'],
      ['/settings/calendar/riverside', 'Riverside Arts'],
      ['/settings/calendar/riverside/general', 'General'],
      ['/settings/account/funding', 'Funding Plan'],
      ['/settings/calendar/riverside/reports/abc', 'Reports'],
      ['/settings/admin/moderation/settings', 'Moderation'],
    ])('titles %s as "%s"', async (path, title) => {
      const w = await mountAt(path);
      expect(w.findAll('h1')).toHaveLength(1);
      expect(heading(w).text()).toBe(title);
    });

    it('is programmatically focusable', async () => {
      const w = await mountAt('/settings/account/profile');
      expect(heading(w).attributes('tabindex')).toBe('-1');
    });

    it('takes focus from focusSettingsHeading', async () => {
      const w = await mountAt('/settings/account/profile', { attachTo: document.body });
      focusSettingsHeading();
      expect(document.activeElement).toBe(heading(w).element);
    });
  });

  describe('eyebrow and switcher', () => {
    it('puts the switcher in the eyebrow on a calendar leaf, outside the h1', async () => {
      const w = await mountAt('/settings/calendar/riverside/editors');
      const switcher = w.findComponent(CalendarSwitcher);
      expect(w.find('.settings-page-header__eyebrow button.calendar-switcher').exists()).toBe(true);
      expect(heading(w).find('button').exists()).toBe(false);
      expect(switcher.props('routeName')).toBe('calendar_editors');
      expect(switcher.props('currentUrlName')).toBe('riverside');
      expect(switcher.props('label')).toBe('Riverside Arts');
      expect(switcher.props('ariaLabel')).toBe('Switch calendar: Riverside Arts');
    });

    it('hands the switcher the parent leaf on report detail, so switching drops the report', async () => {
      const w = await mountAt('/settings/calendar/riverside/reports/abc');
      expect(w.findComponent(CalendarSwitcher).props('routeName')).toBe('calendar_reports');
    });

    it('places the switcher beside the h1 on the calendar section', async () => {
      const w = await mountAt('/settings/calendar/riverside');
      const switcher = w.findComponent(CalendarSwitcher);
      expect(w.find('.settings-page-header__eyebrow').exists()).toBe(false);
      expect(heading(w).find('button').exists()).toBe(false);
      expect(heading(w).element.parentElement?.querySelector(':scope > button.calendar-switcher')).not.toBeNull();
      expect(switcher.props('routeName')).toBe('calendar_management');
      expect(switcher.props('label')).toBe('Switch calendar');
      expect(switcher.props('ariaLabel')).toBe('Switch calendar: Riverside Arts');
    });

    it('shows the group name as text on an account leaf, with no switcher', async () => {
      const w = await mountAt('/settings/account/security');
      expect(w.find('p.settings-page-header__eyebrow').text()).toBe('Account');
      expect(w.findComponent(CalendarSwitcher).exists()).toBe(false);
    });

    it('shows the group name as text on an admin leaf', async () => {
      const w = await mountAt('/settings/admin/settings');
      expect(w.find('p.settings-page-header__eyebrow').text()).toBe('Instance');
    });

    it('renders no eyebrow on a section or the root', async () => {
      let w = await mountAt('/settings/account');
      expect(w.find('.settings-page-header__eyebrow').exists()).toBe(false);
      await navigate('/settings');
      expect(w.find('.settings-page-header__eyebrow').exists()).toBe(false);
    });
  });

  describe('unresolved calendar', () => {
    it('renders identical header markup at the index and at a leaf', async () => {
      const w = await mountAt('/settings/calendar/nope');
      const atIndex = header(w).html();
      await navigate('/settings/calendar/nope/general');
      const atLeaf = header(w).html();

      expect(atLeaf).toBe(atIndex);
      expect(atIndex).not.toContain('nope');
      expect(w.findAll('h1')).toHaveLength(1);
      expect(heading(w).attributes('tabindex')).toBe('-1');
      expect(heading(w).text()).toBe('Calendar');
      expect(backLink(w).attributes('href')).toBe('/settings');
      expect(backLink(w).text()).toBe('Back to Settings');
      expect(w.findComponent(CalendarSwitcher).exists()).toBe(false);
      expect(w.find('.settings-page-header__eyebrow').exists()).toBe(false);
      expect(document.title).toBe('Calendar');
    });
  });

  describe('document.title', () => {
    it.each([
      ['/settings', 'Settings'],
      ['/settings/calendar/riverside', 'Riverside Arts'],
      ['/settings/calendar/riverside/widget', 'Widget'],
    ])('matches the h1 at %s', async (path, title) => {
      const w = await mountAt(path);
      expect(document.title).toBe(title);
      expect(document.title).toBe(heading(w).text());
    });

    it('restores the previous title when the header unmounts', async () => {
      document.title = 'Pavillion';
      const w = await mountAt('/settings/account/profile');
      expect(document.title).toBe('Profile');
      w.unmount();
      wrapper = null;
      expect(document.title).toBe('Pavillion');
    });

    it('follows navigation', async () => {
      const w = await mountAt('/settings/account/profile');
      expect(document.title).toBe('Profile');
      await navigate('/settings/account/security');
      expect(document.title).toBe('Security');
      expect(heading(w).text()).toBe('Security');
    });
  });
});
