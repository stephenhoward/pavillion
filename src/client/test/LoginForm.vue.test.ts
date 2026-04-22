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
  { path: '/register', component: {}, name: 'register', props: true },
  { path: '/forgot', component: {}, name: 'forgot_password', props: true },
  { path: '/apply',  component: {}, name: 'register-apply', props: true },
  { path: '/reset',  component: {}, name: 'reset_password', props: true },
];

interface MountedLoginFormOptions {
  props?: Record<string, any>;
  settings?: Record<string, any>;
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
      site_config: {
        settings: () => options.settings ?? {},
      },
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

// Helpers for link-presence assertions by href (the template has no #register or
// #apply IDs; selecting by ID would always yield a missing element and make
// negative assertions tautological).
const findRegisterLink = (wrapper: ReturnType<typeof mountedLoginForm>['wrapper']) =>
  wrapper.findAll('a').find(a => a.attributes('href')?.includes('/register'));
const findApplyLink = (wrapper: ReturnType<typeof mountedLoginForm>['wrapper']) =>
  wrapper.findAll('a').find(a => a.attributes('href')?.includes('/apply'));

describe('LoginForm Rendering', () => {

  it('should show basic login components', () => {
    const { wrapper } = mountedLoginForm();
    expect(wrapper.find('div.error').exists()).toBe(false);
    expect(wrapper.find('input[type="email"]').exists()).toBe(true);
    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    expect(wrapper.find('button[type="submit"]').exists()).toBe(true);

    expect(findRegisterLink(wrapper)).toBeUndefined();
    expect(findApplyLink(wrapper)).toBeUndefined();
  });

  describe('Closed Registration', () => {
    it('no registration link', () => {
      const { wrapper } = mountedLoginForm({ settings: { registrationMode: 'closed' } });
      expect(findRegisterLink(wrapper)).toBeUndefined();
    });

    it('no apply link', () => {
      const { wrapper } = mountedLoginForm({ settings: { registrationMode: 'closed' } });
      expect(findApplyLink(wrapper)).toBeUndefined();
    });
  });

  describe('Open Registration', () => {
    it('has registration link', () => {
      const { wrapper } = mountedLoginForm({ settings: { registrationMode: 'open' } });
      expect(findRegisterLink(wrapper)).toBeDefined();
    });

    it('no apply link', () => {
      const { wrapper } = mountedLoginForm({ settings: { registrationMode: 'open' } });
      expect(findApplyLink(wrapper)).toBeUndefined();
    });
  });

  describe('Open Applies', () => {
    it('no registration link', () => {
      const { wrapper } = mountedLoginForm({ settings: { registrationMode: 'apply' } });
      expect(findRegisterLink(wrapper)).toBeUndefined();
    });

    it('has apply link', () => {
      const { wrapper } = mountedLoginForm({ settings: { registrationMode: 'apply' } });
      expect(findApplyLink(wrapper)).toBeDefined();
    });
  });

  describe('Invitation Mode', () => {
    it('no registration link', () => {
      const { wrapper } = mountedLoginForm({ settings: { registrationMode: 'invitation' } });
      expect(findRegisterLink(wrapper)).toBeUndefined();
    });

    it('no apply link', () => {
      const { wrapper } = mountedLoginForm({ settings: { registrationMode: 'invitation' } });
      expect(findApplyLink(wrapper)).toBeUndefined();
    });
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
