import { describe, it, expect } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { Calendar, ShieldCheck } from 'lucide-vue-next';
import { mountComponent } from '@/client/test/lib/vue';
import NavList from '@/client/components/logged_in/settings/nav-list.vue';
import {
  calendarItems,
  rootItems,
  type SettingsNavContext,
  type SettingsNavItem,
} from '@/client/components/logged_in/settings/nav-items';

const Stub = { template: '<div />' };

const createTestRouter = (): Router => createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/settings/calendar/:calendar', name: 'calendar_management', component: Stub },
    { path: '/settings/calendar/:calendar/general', name: 'calendar_general', component: Stub },
    { path: '/settings/calendar/:calendar/editors', name: 'calendar_editors', component: Stub },
    { path: '/settings/calendar/:calendar/reports', name: 'calendar_reports', component: Stub },
    { path: '/settings/calendar/:calendar/reports/:reportId', name: 'calendar_report_detail', component: Stub },
    { path: '/settings/calendar/:calendar/import', name: 'calendar_import', component: Stub },
    { path: '/settings/calendar/:calendar/widget', name: 'calendar_widget', component: Stub },
    { path: '/settings/account', name: 'account', component: Stub },
    { path: '/settings/account/profile', name: 'profile', component: Stub },
    { path: '/settings/account/security', name: 'security', component: Stub },
    { path: '/settings/account/funding', name: 'funding_plan', component: Stub },
    { path: '/settings/admin', name: 'admin', component: Stub },
    { path: '/auth/logout', name: 'logout', component: Stub },
  ],
});

function ctx(overrides: Partial<SettingsNavContext> = {}): SettingsNavContext {
  return {
    calendarUrlName: 'art',
    isOwner: true,
    isAdmin: true,
    fundingEnabled: true,
    ...overrides,
  };
}

async function mountAt(path: string, items: SettingsNavItem[], mode: 'page' | 'sidebar' = 'page') {
  const router = createTestRouter();
  await router.push(path);
  await router.isReady();
  const wrapper = mountComponent(NavList, router, { props: { items, mode } });
  return { wrapper, router };
}

describe('settings nav-list', () => {
  it('marks exactly the matching calendar leaf as the current page', async () => {
    const { wrapper } = await mountAt('/settings/calendar/art/editors', calendarItems(ctx()));

    const current = wrapper.findAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].text()).toBe('Editors');
  });

  it('keeps the Reports row current on a report detail beneath it', async () => {
    const { wrapper } = await mountAt(
      '/settings/calendar/art/reports/4f1c2b3a-9d8e-4c7b-a6f5-0e1d2c3b4a59',
      calendarItems(ctx()),
    );

    const current = wrapper.findAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].text()).toBe('Reports');
  });

  it.each([
    { order: 'parent first', reportsFirst: false },
    { order: 'nested row first', reportsFirst: true },
  ])('marks only the deepest matching row current ($order)', async ({ reportsFirst }) => {
    const parent: SettingsNavItem = {
      id: 'calendar', routeName: 'calendar_management', labelKey: 'nav.root.calendar', icon: Calendar,
      to: { name: 'calendar_management', params: { calendar: 'art' } },
    };
    const reports: SettingsNavItem = {
      id: 'reports', routeName: 'calendar_reports', labelKey: 'nav.calendar.reports', icon: ShieldCheck,
      to: { name: 'calendar_reports', params: { calendar: 'art' } },
    };
    const items = reportsFirst ? [reports, parent] : [parent, reports];
    const { wrapper } = await mountAt('/settings/calendar/art/reports/4f1c2b3a-9d8e-4c7b-a6f5-0e1d2c3b4a59', items);

    const current = wrapper.findAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].text()).toBe('Reports');
  });

  it('marks the root Calendar row current on a leaf of that calendar', async () => {
    const { wrapper } = await mountAt('/settings/calendar/art/general', rootItems(ctx()));

    const current = wrapper.findAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].text()).toBe('Calendar');
  });

  it('does not match a calendar whose name only shares a prefix', async () => {
    const { wrapper } = await mountAt('/settings/calendar/art-club/general', rootItems(ctx()));

    expect(wrapper.findAll('[aria-current="page"]')).toHaveLength(0);
  });

  it('hides every page-mode chevron from assistive technology', async () => {
    const items = calendarItems(ctx());
    const { wrapper } = await mountAt('/settings/calendar/art/general', items, 'page');

    const chevrons = wrapper.findAll('.shell-nav-item__chevron');
    expect(chevrons).toHaveLength(items.length);
    for (const chevron of chevrons) {
      expect(chevron.attributes('aria-hidden')).toBe('true');
    }
  });

  it('sets the mode as a static modifier on the list', async () => {
    const { wrapper } = await mountAt('/settings/account', rootItems(ctx()), 'sidebar');

    expect(wrapper.find('ul').classes()).toContain('settings-nav--sidebar');
  });

  it('renders Log out as the last row, a button that is never current', async () => {
    const items = rootItems(ctx());
    const reordered = [items[items.length - 1], ...items.slice(0, -1)];
    const { wrapper } = await mountAt('/settings/account', reordered);

    const rows = wrapper.findAll('li');
    const last = rows[rows.length - 1];
    const button = last.find('button');
    expect(button.exists()).toBe(true);
    expect(button.attributes('type')).toBe('button');
    expect(button.text()).toBe('Log out');
    expect(button.attributes('aria-current')).toBeUndefined();
    expect(button.classes()).toContain('shell-nav-item--danger');
    expect(button.find('.shell-nav-item__chevron').exists()).toBe(false);
  });

  it('pushes the logout route when Log out is activated', async () => {
    const { wrapper, router } = await mountAt('/settings/account', rootItems(ctx()));

    await wrapper.find('li:last-child button').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('logout');
  });

  it('puts no id attribute inside the list', async () => {
    const { wrapper } = await mountAt('/settings/calendar/art/general', rootItems(ctx()));

    expect(wrapper.findAll('[id]')).toHaveLength(0);
  });
});
