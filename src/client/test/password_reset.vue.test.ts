import { expect, describe, it, beforeEach, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';

import { mountComponent } from '@/client/test/lib/vue';
import PasswordReset from '@/client/components/logged_out/password_reset.vue';

const routes: RouteRecordRaw[] = [
  { path: '/login', component: {}, name: 'login', props: true },
  { path: '/reset', component: {}, name: 'reset_password', props: true },
  { path: '/forgot', component: {}, name: 'forgot_password', props: true },
];

const mountPasswordReset = (authnOverrides: Record<string, any> = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });
  const authn = {
    check_password_reset_token: async () => ({ valid: true, isNewAccount: false }),
    use_password_reset_token: async () => ({}),
    ...authnOverrides,
  };
  const wrapper = mountComponent(PasswordReset, router, {
    provide: { authn },
  });
  return { wrapper, router, authn };
};

describe('Password Reset Error Alert', () => {
  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    // reset sandbox each test
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('failed reset code submission renders alert text with linked aria-describedby', async () => {
    const { wrapper } = mountPasswordReset({
      check_password_reset_token: async () => ({ valid: false }),
    });

    // The form starts with code entry — submit an empty code to trigger the invalid flow
    await wrapper.find('input#reset-code').setValue('bad-code');
    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text().length).toBeGreaterThan(0);
    expect(alert.attributes('id')).toBe('reset-code-error');
    expect(alert.attributes('aria-live')).toBe('polite');

    const codeInput = wrapper.find('input#reset-code');
    expect(codeInput.attributes('aria-describedby')).toBe('reset-code-error');
    expect(wrapper.find('#reset-code-error').exists()).toBe(true);
  });

  it('password entry form with mismatched passwords renders alert linked to both password inputs', async () => {
    const { wrapper } = mountPasswordReset({
      check_password_reset_token: async () => ({ valid: true, isNewAccount: false }),
    });

    // Advance to the password-entry step by submitting a valid code
    await wrapper.find('input#reset-code').setValue('good-code');
    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    // Now we should be on the password form
    await wrapper.find('input#new-password').setValue('abc');
    await wrapper.find('input#confirm-password').setValue('xyz');
    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.attributes('id')).toBe('reset-password-error');

    const newPassword = wrapper.find('input#new-password');
    const confirmPassword = wrapper.find('input#confirm-password');
    expect(newPassword.attributes('aria-describedby')).toBe('reset-password-error');
    expect(confirmPassword.attributes('aria-describedby')).toBe('reset-password-error');

    // aria-describedby resolves to the rendered alert element
    expect(wrapper.find('#reset-password-error').exists()).toBe(true);
  });
});
