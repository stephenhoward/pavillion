import { describe, it, expect } from 'vitest';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw, RouterLink } from 'vue-router';
import { flushPromises } from '@vue/test-utils';

import PolicyLink from '@/client/components/common/PolicyLink.vue';
import { mountComponent } from '@/client/test/lib/vue';

const routes: RouteRecordRaw[] = [
  { path: '/', component: {}, name: 'home' },
  { path: '/policy', component: {}, name: 'instance-policy' },
];

type MountOpts = {
  props?: Record<string, unknown>;
  domain?: string | null;
};

const mountPolicyLink = async ({ props = {}, domain = 'pavillion.dev' }: MountOpts = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  await router.push('/');
  await router.isReady();

  const provide = {
    site_config: domain === null ? {} : { settings: () => ({ domain }) },
  };

  return mountComponent(PolicyLink, router, { props, provide });
};

describe('PolicyLink', () => {
  it('renders a router-link pointing at the instance-policy named route', async () => {
    const wrapper = await mountPolicyLink();
    await flushPromises();

    const link = wrapper.findComponent(RouterLink);
    expect(link.exists()).toBe(true);
    expect(link.props('to')).toEqual({ name: 'instance-policy' });
  });

  it('renders only the "Read the rules" portion as a link with the rest as plain text', async () => {
    const wrapper = await mountPolicyLink();
    await flushPromises();

    const link = wrapper.findComponent(RouterLink);
    expect(link.text()).toBe('Read the rules');
    expect(wrapper.html()).toContain('for calendars hosted on pavillion.dev');
  });

  it('falls back to an empty domain when site_config is missing', async () => {
    const wrapper = await mountPolicyLink({ domain: null });
    await flushPromises();

    expect(wrapper.html()).toContain('for calendars hosted on');
  });

  it('honors a custom label prop by rendering the entire label as the link text', async () => {
    const wrapper = await mountPolicyLink({ props: { label: 'Read our policy' } });
    await flushPromises();

    const link = wrapper.findComponent(RouterLink);
    expect(link.text()).toBe('Read our policy');
    expect(wrapper.text()).toBe('Read our policy');
  });

  it('forwards the source prop as a from query param so the policy page can render a contextual back link', async () => {
    const wrapper = await mountPolicyLink({ props: { source: 'register-apply' } });
    await flushPromises();

    const link = wrapper.findComponent(RouterLink);
    expect(link.props('to')).toEqual({
      name: 'instance-policy',
      query: { from: 'register-apply' },
    });
  });
});
