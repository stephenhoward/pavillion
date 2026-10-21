import { describe, it, expect } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { mountComponent } from '@/client/test/lib/vue';
import AdminRoot from '@/client/components/admin/root.vue';

const App = { template: '<RouterView />' };
const Index = { template: '<p data-pane="index" />' };
const Pane = { template: '<p data-pane="leaf" />' };

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/settings/admin', component: AdminRoot, children: [
        { path: '', component: Index, name: 'admin' },
        { path: 'settings', component: Pane, name: 'admin_settings' },
        { path: 'federation', component: Pane, name: 'federation' },
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
  it.each([
    ['/settings/admin', 'index'],
    ['/settings/admin/federation', 'leaf'],
  ])('renders the matched child of %s through its RouterView', async (path, pane) => {
    const wrapper = await mountAt(path);
    expect(wrapper.find('.admin-root').exists()).toBe(true);
    expect(wrapper.find(`.admin-root > [data-pane="${pane}"]`).exists()).toBe(true);
  });

  it('renders no nav, no current-page link and no main landmark of its own', async () => {
    const wrapper = await mountAt('/settings/admin/settings');
    expect(wrapper.find('nav').exists()).toBe(false);
    expect(wrapper.find('a').exists()).toBe(false);
    expect(wrapper.find('[aria-current="page"]').exists()).toBe(false);
    expect(wrapper.find('main').exists()).toBe(false);
  });
});
