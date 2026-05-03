import { expect, describe, it, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';

import { mountComponent } from '@/client/test/lib/vue';
import Register from '@/client/components/logged_out/register.vue';
import PolicyLink from '@/client/components/common/PolicyLink.vue';

const routes: RouteRecordRaw[] = [
  { path: '/login',  component: {}, name: 'login', props: true },
  { path: '/register', component: {}, name: 'register', props: true },
  { path: '/apply',  component: {}, name: 'register-apply', props: true },
  { path: '/reset',  component: {}, name: 'reset_password', props: true },
  { path: '/policy', component: {}, name: 'instance-policy' },
];

const mountedRegister = () => {
  let router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });
  let authn = {
    register: async () => {
      return true;
    },
  };

  const wrapper = mountComponent(Register, router, {
    provide: {
      site_config: {
        settings: () => ({ registrationMode: 'open' }),
      },
      authn,
    },
    stubs: {
      SuccessState: { template: '<div class="success-stub"><slot /></div>' },
    },
  });

  return { wrapper, router, authn };
};

describe('Register Form Validation', () => {
  const sandbox = sinon.createSandbox();
  let currentWrapper: ReturnType<typeof mountedRegister>['wrapper'] | null = null;

  afterEach(() => {
    currentWrapper?.unmount();
    currentWrapper = null;
    sandbox.restore();
  });

  it('missing email shows error', async () => {
    const { wrapper, authn } = mountedRegister();
    currentWrapper = wrapper;
    let registerStub = sandbox.stub(authn, 'register');

    await wrapper.find('input[type="email"]').setValue('');

    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(registerStub.called).toBe(false);
  });

  it('invalid email format shows error', async () => {
    const { wrapper, authn } = mountedRegister();
    currentWrapper = wrapper;
    let registerStub = sandbox.stub(authn, 'register');

    await wrapper.find('input[type="email"]').setValue('not-an-email');

    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(registerStub.called).toBe(false);
  });

  it('valid email proceeds to registration', async () => {
    const { wrapper, authn } = mountedRegister();
    currentWrapper = wrapper;
    let registerStub = sandbox.stub(authn, 'register');
    registerStub.resolves();

    await wrapper.find('input[type="email"]').setValue('user@example.com');

    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(registerStub.calledWith('user@example.com')).toBe(true);
    expect(wrapper.find('.success-stub').isVisible()).toBe(true);
  });

  it('failed registration renders translated alert text with proper ARIA wiring', async () => {
    const { wrapper, authn } = mountedRegister();
    currentWrapper = wrapper;
    let registerStub = sandbox.stub(authn, 'register');
    registerStub.rejects({ message: 'unknown_error' });

    await wrapper.find('input[type="email"]').setValue('user@example.com');
    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text().length).toBeGreaterThan(0);
    expect(alert.attributes('id')).toBe('register-error');
    expect(alert.attributes('aria-live')).toBe('polite');

    const emailInput = wrapper.find('input[type="email"]');
    expect(emailInput.attributes('aria-describedby')).toBe('register-error');
    expect(wrapper.find('#register-error').exists()).toBe(true);
  });

  it('renders the shared PolicyLink component', async () => {
    const { wrapper } = mountedRegister();
    currentWrapper = wrapper;
    await flushPromises();

    expect(wrapper.findComponent(PolicyLink).exists()).toBe(true);
  });

  it('surfaces initial error from props.error via ErrorAlert', async () => {
    let router = createRouter({
      history: createMemoryHistory(),
      routes: routes,
    });
    let authn = { register: async () => true };

    const wrapper = mountComponent(Register, router, {
      provide: {
        site_config: { settings: () => ({ registrationMode: 'open' }) },
        authn,
      },
      props: { error: 'boom', em: 'prefilled@example.com' },
      stubs: {
        SuccessState: { template: '<div class="success-stub"><slot /></div>' },
      },
    });
    currentWrapper = wrapper;
    await flushPromises();

    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain('boom');

    const emailInput = wrapper.find('input[type="email"]');
    expect((emailInput.element as HTMLInputElement).value).toBe('prefilled@example.com');
  });
});
