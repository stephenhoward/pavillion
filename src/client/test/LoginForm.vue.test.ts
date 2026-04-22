import { expect, describe, it, afterEach } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';

import { mountComponent } from '@/client/test/lib/vue';
import LoginForm from '@/client/components/logged_out/LoginForm.vue';
import ErrorAlert from '@/client/components/logged_out/error-alert.vue';

const routes: RouteRecordRaw[] = [
  { path: '/login',  component: {}, name: 'login', props: true },
  { path: '/logout', component: {}, name: 'logout' },
  { path: '/reset',  component: {}, name: 'reset_password', props: true },
];

interface MountedLoginFormOptions {
  props?: Record<string, any>;
}

const mountedLoginForm = (options: MountedLoginFormOptions = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });
  const authn = {
    login: async () => {
      return false;
    },
  };

  const wrapper = mountComponent(LoginForm, router, {
    provide: {
      authn,
    },
    props: options.props ?? {},
  });

  return {
    wrapper,
    router,
    authn,
  };
};

describe('LoginForm Rendering', () => {

  it('should show basic login components', () => {
    const { wrapper } = mountedLoginForm();
    expect(wrapper.find('div.error').exists()).toBe(false);
    expect(wrapper.find('input[type="email"]').exists()).toBe(true);
    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    expect(wrapper.find('button[type="submit"]').exists()).toBe(true);
  });
});

describe('LoginForm Props', () => {

  it('preseeds email field from initialEmail prop', () => {
    const { wrapper } = mountedLoginForm({ props: { initialEmail: 'prefilled@example.com' } });
    const emailInput = wrapper.find('input[type="email"]');
    expect((emailInput.element as HTMLInputElement).value).toBe('prefilled@example.com');
  });

  it('starts with empty email when initialEmail is not provided', () => {
    const { wrapper } = mountedLoginForm();
    const emailInput = wrapper.find('input[type="email"]');
    expect((emailInput.element as HTMLInputElement).value).toBe('');
  });

  it('renders the title as an h2 by default', () => {
    const { wrapper } = mountedLoginForm();
    expect(wrapper.find('h2').exists()).toBe(true);
    expect(wrapper.find('h3').exists()).toBe(false);
  });

  it('renders the title as an h3 when headingLevel="h3" prop is passed', () => {
    const { wrapper } = mountedLoginForm({ props: { headingLevel: 'h3' } });
    expect(wrapper.find('h3').exists()).toBe(true);
    expect(wrapper.find('h2').exists()).toBe(false);
  });
});

describe('LoginForm Emits', () => {

  it('emits update:email with the typed value when the user types into the email input', async () => {
    const { wrapper } = mountedLoginForm();

    await wrapper.find('input[type="email"]').setValue('typed@example.com');
    await wrapper.vm.$nextTick();

    const emitted = wrapper.emitted('update:email');
    expect(emitted).toBeDefined();
    expect(emitted!.length).toBe(1);
    expect(emitted![0]).toEqual(['typed@example.com']);
  });

  it('emits update:email with the empty string when the user clears the email input', async () => {
    const { wrapper } = mountedLoginForm({ props: { initialEmail: 'start@example.com' } });

    await wrapper.find('input[type="email"]').setValue('');
    await wrapper.vm.$nextTick();

    const emitted = wrapper.emitted('update:email');
    expect(emitted).toBeDefined();
    expect(emitted![emitted!.length - 1]).toEqual(['']);
  });
});

describe('LoginForm Behavior', () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());

  it('missing email', async () => {
    const { wrapper, authn } = mountedLoginForm();
    const loginStub = sandbox.stub(authn, 'login');

    await wrapper.find('input[type="email"]').setValue('');
    await wrapper.find('input[type="password"]').setValue('password');

    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.emitted('success')).toBeUndefined();
    expect(loginStub.called).toBe(false);
  });

  it('invalid email format', async () => {
    const { wrapper, authn } = mountedLoginForm();
    const loginStub = sandbox.stub(authn, 'login');

    await wrapper.find('input[type="email"]').setValue('not-an-email');
    await wrapper.find('input[type="password"]').setValue('password');

    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.emitted('success')).toBeUndefined();
    expect(loginStub.called).toBe(false);
  });

  it('missing password', async () => {
    const { wrapper, authn } = mountedLoginForm();
    const loginStub = sandbox.stub(authn, 'login');

    await wrapper.find('input[type="email"]').setValue('user@example.com');
    await wrapper.find('input[type="password"]').setValue('');

    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.emitted('success')).toBeUndefined();
    expect(loginStub.called).toBe(false);
  });

  it('fail login', async () => {
    const { wrapper, authn } = mountedLoginForm();
    const loginStub = sandbox.stub(authn, 'login');

    loginStub.resolves(false);

    await wrapper.find('input[type="email"]').setValue('user@example.com');
    await wrapper.find('input[type="password"]').setValue('password');

    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.emitted('success')).toBeUndefined();
    expect(loginStub.called).toBe(true);
  });

  it('failed login renders translated alert text with proper ARIA wiring', async () => {
    const { wrapper, authn } = mountedLoginForm();
    const loginStub = sandbox.stub(authn, 'login');

    loginStub.resolves(false);

    await wrapper.find('input[type="email"]').setValue('user@example.com');
    await wrapper.find('input[type="password"]').setValue('password');
    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text().length).toBeGreaterThan(0);
    expect(alert.attributes('id')).toBe('login-error');
    expect(alert.attributes('aria-live')).toBe('polite');

    const emailInput = wrapper.find('input[type="email"]');
    const passwordInput = wrapper.find('input[type="password"]');
    const submitButton = wrapper.find('button[type="submit"]');

    expect(emailInput.attributes('aria-describedby')).toBe('login-error');
    expect(passwordInput.attributes('aria-describedby')).toBe('login-error');
    expect(submitButton.attributes('aria-describedby')).toBe('login-error');

    // aria-describedby should resolve to a real element in the DOM
    expect(wrapper.find('#login-error').exists()).toBe(true);

    // The red field state is applied alongside the alert
    expect(emailInput.classes()).toContain('form-control--error');
    expect(passwordInput.classes()).toContain('form-control--error');

    expect(wrapper.emitted('success')).toBeUndefined();
  });

  it('successful retry clears both the red field class and the alert element', async () => {
    const { wrapper, authn } = mountedLoginForm();
    const loginStub = sandbox.stub(authn, 'login');

    // First: failed login
    loginStub.onFirstCall().resolves(false);
    await wrapper.find('input[type="email"]').setValue('user@example.com');
    await wrapper.find('input[type="password"]').setValue('password');
    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.find('input[type="email"]').classes()).toContain('form-control--error');

    // Then: successful retry
    loginStub.onSecondCall().resolves(true);
    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.find('input[type="email"]').classes()).not.toContain('form-control--error');
    expect(wrapper.find('input[type="email"]').attributes('aria-describedby')).toBeUndefined();
    expect(wrapper.find('input[type="password"]').attributes('aria-describedby')).toBeUndefined();
  });

  it('catch login error', async () => {
    const { wrapper, authn } = mountedLoginForm();
    const loginStub = sandbox.stub(authn, 'login');

    loginStub.throws('ouch');

    await wrapper.find('input[type="email"]').setValue('user@example.com');
    await wrapper.find('input[type="password"]').setValue('password');

    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.emitted('success')).toBeUndefined();
    expect(loginStub.called).toBe(true);
  });

  it('empty-string error on ErrorAlert renders no alert element', () => {
    const wrapper = mountComponent(
      { components: { ErrorAlert }, template: '<ErrorAlert id="test-error" error="" />' },
      createRouter({ history: createMemoryHistory(), routes }),
      {},
    );
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('emits success event on valid login', async () => {
    const { wrapper, authn } = mountedLoginForm();
    const loginStub = sandbox.stub(authn, 'login');

    loginStub.resolves(true);

    await wrapper.find('input[type="email"]').setValue('user@example.com');
    await wrapper.find('input[type="password"]').setValue('password');

    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.emitted('success')).toBeDefined();
    expect(wrapper.emitted('success')!.length).toBe(1);
    expect(loginStub.called).toBe(true);
  });
});

