import { describe, it, expect } from 'vitest';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw, RouterLink } from 'vue-router';
import { flushPromises } from '@vue/test-utils';

import PolicyLink from '@/client/components/common/PolicyLink.vue';
import { mountComponent } from '@/client/test/lib/vue';

const routes: RouteRecordRaw[] = [
  { path: '/', component: {}, name: 'home' },
  { path: '/policy', component: {}, name: 'instance-policy' },
];

const mountPolicyLink = async (props: Record<string, unknown> = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  await router.push('/');
  await router.isReady();

  return mountComponent(PolicyLink, router, { props });
};

describe('PolicyLink', () => {
  it('renders a router-link pointing at the instance-policy named route', async () => {
    const wrapper = await mountPolicyLink();
    await flushPromises();

    const link = wrapper.findComponent(RouterLink);
    expect(link.exists()).toBe(true);
    expect(link.props('to')).toEqual({ name: 'instance-policy' });
  });

  it('uses the navigation.view_policy translation as the default label', async () => {
    const wrapper = await mountPolicyLink();
    await flushPromises();

    expect(wrapper.text()).toBe('View policy');
  });

  it('honors a custom label prop when provided', async () => {
    const wrapper = await mountPolicyLink({ label: 'Read our policy' });
    await flushPromises();

    expect(wrapper.text()).toBe('Read our policy');
  });
});
