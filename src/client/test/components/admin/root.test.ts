import { describe, it, expect } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { mountComponent } from '@/client/test/lib/vue';
import AdminRoot from '@/client/components/admin/root.vue';

const App = { template: '<RouterView />' };
const Pane = { template: '<div />' };

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/settings/account', component: Pane, name: 'profile' },
      { path: '/settings/admin', component: AdminRoot, name: 'admin', children: [
        { path: 'settings', component: Pane, name: 'admin_settings' },
        { path: 'accounts', component: Pane, name: 'accounts' },
        { path: 'calendars', component: Pane, name: 'admin_calendars' },
        { path: 'moderation', component: Pane, name: 'moderation' },
        { path: 'moderation/settings', component: Pane, name: 'moderation_settings' },
        { path: 'federation', component: Pane, name: 'federation' },
        { path: 'funding', component: Pane, name: 'funding' },
      ] },
    ],
  });
}

async function mountAt(path: string) {
  const router = makeRouter();
  await router.push(path);
  const wrapper = mountComponent(App, router);
  await flushPromises();
  return wrapper;
}

describe('admin root', () => {
  it('links its pages under /settings/admin and has no back link', async () => {
    const wrapper = await mountAt('/settings/admin/settings');
    expect(wrapper.find('.admin-back-link').exists()).toBe(false);
    expect(wrapper.find('a[href="/settings/account"]').exists()).toBe(false);
    const hrefs = wrapper.findAll('a').map((a) => a.attributes('href'));
    expect(hrefs).toContain('/settings/admin/accounts');
    expect(hrefs.some((href) => href?.startsWith('/admin/'))).toBe(false);
  });

  it('marks the nav item for the current page in both navs', async () => {
    const wrapper = await mountAt('/settings/admin/federation');
    const current = wrapper.findAll('a[aria-current="page"]');
    expect(current.map((a) => a.attributes('href'))).toEqual([
      '/settings/admin/federation',
      '/settings/admin/federation',
    ]);
  });
});
