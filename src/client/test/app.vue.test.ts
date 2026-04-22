import { expect, describe, it } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { ref } from 'vue';

import { mountComponent } from '@/client/test/lib/vue';
import App from '@/client/components/app.vue';
import SessionExpiredModal from '@/client/components/common/session-expired-modal.vue';

const routes: RouteRecordRaw[] = [
  { path: '/', component: { template: '<div />' }, name: 'home' },
  { path: '/auth/login', component: { template: '<div />' }, name: 'login', props: true },
  { path: '/auth/register', component: { template: '<div />' }, name: 'register', props: true },
  { path: '/auth/forgot', component: { template: '<div />' }, name: 'forgot_password', props: true },
  { path: '/auth/apply', component: { template: '<div />' }, name: 'register-apply', props: true },
  { path: '/auth/reset', component: { template: '<div />' }, name: 'reset_password', props: true },
];

const mountApp = async (sessionExpiredValue: boolean) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  await router.push('/');
  await router.isReady();

  const authn = {
    sessionExpired: ref(sessionExpiredValue),
    lastKnownEmail: null,
    drainPendingRequests: async () => {},
    abortPendingRequests: () => {},
    login: async () => false,
  };

  const wrapper = mountComponent(App, router, {
    provide: {
      authn,
      site_config: {
        settings: () => ({}),
      },
    },
  });

  return { wrapper, authn };
};

describe('App SessionExpiredModal gating', () => {
  it('does NOT render SessionExpiredModal when authn.sessionExpired is false', async () => {
    const { wrapper } = await mountApp(false);
    expect(wrapper.findComponent(SessionExpiredModal).exists()).toBe(false);
  });

  it('renders SessionExpiredModal when authn.sessionExpired is true', async () => {
    const { wrapper } = await mountApp(true);
    expect(wrapper.findComponent(SessionExpiredModal).exists()).toBe(true);
  });
});
