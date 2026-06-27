import { expect, describe, it, afterEach } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';
import { ref } from 'vue';

import { mountComponent } from '@/client/test/lib/vue';
import SessionExpiredModal from '@/client/components/common/session-expired-modal.vue';
import Modal from '@/client/components/common/modal.vue';
import LoginForm from '@/client/components/logged_out/LoginForm.vue';

const routes: RouteRecordRaw[] = [
  { path: '/', component: {}, name: 'home' },
  { path: '/auth/login', component: {}, name: 'login', props: true },
  { path: '/auth/register', component: {}, name: 'register', props: true },
  { path: '/auth/forgot', component: {}, name: 'forgot_password', props: true },
  { path: '/auth/apply', component: {}, name: 'register-apply', props: true },
  { path: '/auth/reset', component: {}, name: 'reset_password', props: true },
];

interface MountedOptions {
  lastKnownEmail?: string | null;
  sandbox?: sinon.SinonSandbox;
}

const mountedSessionExpiredModal = (options: MountedOptions = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  const sandbox = options.sandbox ?? sinon.createSandbox();
  const sessionExpired = ref(true);

  // Fakes implement the real side effect: drain/abort both clear the sessionExpired flag,
  // which is what causes the modal to unmount when the parent (app.vue) re-renders.
  const authn = {
    sessionExpired,
    lastKnownEmail: options.lastKnownEmail ?? null,
    drainPendingRequests: sandbox.stub().callsFake(async () => {
      sessionExpired.value = false;
    }),
    abortPendingRequests: sandbox.stub().callsFake(() => {
      sessionExpired.value = false;
    }),
    login: sandbox.stub().resolves(false),
  };

  const wrapper = mountComponent(SessionExpiredModal, router, {
    provide: {
      site_config: {
        settings: () => ({}),
      },
      authn,
    },
  });

  return { wrapper, router, authn, sessionExpired };
};

describe('SessionExpiredModal Rendering', () => {
  it('renders the Modal and embedded LoginForm', () => {
    const { wrapper } = mountedSessionExpiredModal();
    expect(wrapper.findComponent(Modal).exists()).toBe(true);
    expect(wrapper.findComponent(LoginForm).exists()).toBe(true);
  });

  it('passes authn.lastKnownEmail as initialEmail to LoginForm', () => {
    const { wrapper } = mountedSessionExpiredModal({ lastKnownEmail: 'user@example.com' });
    const loginForm = wrapper.findComponent(LoginForm);
    expect(loginForm.props('initialEmail')).toBe('user@example.com');
  });

  it('passes empty string as initialEmail when lastKnownEmail is null', () => {
    const { wrapper } = mountedSessionExpiredModal({ lastKnownEmail: null });
    const loginForm = wrapper.findComponent(LoginForm);
    expect(loginForm.props('initialEmail')).toBe('');
  });

  // Regression: pv-rh4z / PR #234 — the session-expired modal re-authenticates
  // the existing user in place. It must not surface register, apply-for-account,
  // or forgot-password affordances (those belong on the standalone /auth/login
  // page, not in the modal).
  it('does not render register, apply, or forgot-password affordances', () => {
    const { wrapper } = mountedSessionExpiredModal();
    const html = wrapper.html();

    // No links/buttons pointing at the auxiliary auth routes
    expect(wrapper.find('a[href*="/auth/register"]').exists()).toBe(false);
    expect(wrapper.find('a[href*="/auth/apply"]').exists()).toBe(false);
    expect(wrapper.find('a[href*="/auth/forgot"]').exists()).toBe(false);
    expect(wrapper.find('a[href*="/auth/reset"]').exists()).toBe(false);

    // No router-link navigation to those named routes either
    expect(wrapper.find('[to*="register"]').exists()).toBe(false);
    expect(wrapper.find('[to*="forgot"]').exists()).toBe(false);
    expect(wrapper.find('[to*="apply"]').exists()).toBe(false);

    // Rendered markup contains no copy hinting at those flows
    expect(html).not.toMatch(/register/i);
    expect(html).not.toMatch(/apply/i);
    expect(html).not.toMatch(/forgot/i);
  });
});

describe('SessionExpiredModal Behavior', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => sandbox.restore());

  it('drains pending requests and clears sessionExpired when LoginForm emits success', async () => {
    const { wrapper, authn, sessionExpired } = mountedSessionExpiredModal({ sandbox });

    const loginForm = wrapper.findComponent(LoginForm);
    await loginForm.vm.$emit('success');
    await wrapper.vm.$nextTick();

    expect(authn.drainPendingRequests.calledOnce).toBe(true);
    expect(authn.abortPendingRequests.called).toBe(false);
    // The modal is dismissed because sessionExpired is now false
    expect(sessionExpired.value).toBe(false);
  });

  it('aborts pending requests, clears sessionExpired, and routes to /auth/login on Modal close', async () => {
    const { wrapper, router, authn, sessionExpired } = mountedSessionExpiredModal({ sandbox });

    const pushSpy = sandbox.spy(router, 'push');

    const modal = wrapper.findComponent(Modal);
    await modal.vm.$emit('close');
    await wrapper.vm.$nextTick();

    expect(authn.abortPendingRequests.calledOnce).toBe(true);
    expect(authn.drainPendingRequests.called).toBe(false);
    // The modal is dismissed because sessionExpired is now false
    expect(sessionExpired.value).toBe(false);
    expect(pushSpy.calledOnce).toBe(true);
    expect(pushSpy.firstCall.args[0]).toEqual('/auth/login');
  });
});
