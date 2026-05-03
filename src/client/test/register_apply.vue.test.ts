import { expect, describe, it, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';

import { mountComponent } from '@/client/test/lib/vue';
import RegisterApply from '@/client/components/logged_out/register_apply.vue';
import PolicyLink from '@/client/components/common/PolicyLink.vue';

const routes: RouteRecordRaw[] = [
  { path: '/login',  component: {}, name: 'login', props: true },
  { path: '/register', component: {}, name: 'register', props: true },
  { path: '/apply',  component: {}, name: 'register-apply', props: true },
  { path: '/reset',  component: {}, name: 'reset_password', props: true },
  { path: '/policy', component: {}, name: 'instance-policy' },
];

const mountedApply = () => {
  let router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });
  let authn = {
    register_apply: async () => {
      return true;
    },
  };

  const wrapper = mountComponent(RegisterApply, router, {
    provide: {
      site_config: {
        settings: () => ({ registrationMode: 'apply' }),
      },
      authn,
    },
    stubs: {
      SuccessState: { template: '<div class="success-stub"><slot /></div>' },
    },
  });

  return { wrapper, router, authn };
};

describe('Register Apply Form Validation', () => {
  const sandbox = sinon.createSandbox();
  let currentWrapper: ReturnType<typeof mountedApply>['wrapper'] | null = null;

  afterEach(() => {
    currentWrapper?.unmount();
    currentWrapper = null;
    sandbox.restore();
  });

  it('missing email shows error', async () => {
    const { wrapper, authn } = mountedApply();
    currentWrapper = wrapper;
    let applyStub = sandbox.stub(authn, 'register_apply');

    await wrapper.find('input[type="email"]').setValue('');

    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(applyStub.called).toBe(false);
  });

  it('missing message with valid email shows error', async () => {
    const { wrapper, authn } = mountedApply();
    currentWrapper = wrapper;
    let applyStub = sandbox.stub(authn, 'register_apply');

    await wrapper.find('input[type="email"]').setValue('user@example.com');

    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(applyStub.called).toBe(false);
  });

  it('invalid email format shows error', async () => {
    const { wrapper, authn } = mountedApply();
    currentWrapper = wrapper;
    let applyStub = sandbox.stub(authn, 'register_apply');

    await wrapper.find('input[type="email"]').setValue('not-an-email');
    await wrapper.find('textarea').setValue('I would like to join');

    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(applyStub.called).toBe(false);
  });

  it('renders the shared PolicyLink component', async () => {
    const { wrapper } = mountedApply();
    currentWrapper = wrapper;
    await flushPromises();

    expect(wrapper.findComponent(PolicyLink).exists()).toBe(true);
  });

  it('valid email with message proceeds to apply', async () => {
    const { wrapper, authn } = mountedApply();
    currentWrapper = wrapper;
    let applyStub = sandbox.stub(authn, 'register_apply');
    applyStub.resolves();

    await wrapper.find('input[type="email"]').setValue('user@example.com');
    await wrapper.find('textarea').setValue('I would like to join');

    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(applyStub.calledWith('user@example.com', 'I would like to join')).toBe(true);
    expect(wrapper.find('.success-stub').isVisible()).toBe(true);
  });
});
