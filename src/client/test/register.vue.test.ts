import { expect, describe, it, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';

import { mountComponent } from '@/client/test/lib/vue';
import Register from '@/client/components/logged_out/register.vue';

const routes: RouteRecordRaw[] = [
  { path: '/login',  component: {}, name: 'login', props: true },
  { path: '/register', component: {}, name: 'register', props: true },
  { path: '/apply',  component: {}, name: 'register-apply', props: true },
  { path: '/reset',  component: {}, name: 'reset_password', props: true },
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
});
