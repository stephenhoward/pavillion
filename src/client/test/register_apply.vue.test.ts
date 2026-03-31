import { expect, describe, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';

import { mountComponent } from '@/client/test/lib/vue';
import RegisterApply from '@/client/components/logged_out/register_apply.vue';

const routes: RouteRecordRaw[] = [
  { path: '/login',  component: {}, name: 'login', props: true },
  { path: '/register', component: {}, name: 'register', props: true },
  { path: '/apply',  component: {}, name: 'register-apply', props: true },
  { path: '/reset',  component: {}, name: 'reset_password', props: true },
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
  });

  return { wrapper, router, authn };
};

describe('Register Apply Form Validation', () => {

  it('missing fields shows error', async () => {
    const { wrapper, authn } = mountedApply();
    let applyStub = sinon.createSandbox().stub(authn, 'register_apply');

    await wrapper.find('input[type="email"]').setValue('');

    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(applyStub.called).toBe(false);
  });

  it('invalid email format shows error', async () => {
    const { wrapper, authn } = mountedApply();
    let applyStub = sinon.createSandbox().stub(authn, 'register_apply');

    await wrapper.find('input[type="email"]').setValue('not-an-email');
    await wrapper.find('textarea').setValue('I would like to join');

    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(applyStub.called).toBe(false);
  });

  it('valid email with message proceeds to apply', async () => {
    const { wrapper, authn } = mountedApply();
    let applyStub = sinon.createSandbox().stub(authn, 'register_apply');
    applyStub.resolves();

    await wrapper.find('input[type="email"]').setValue('user@example.com');
    await wrapper.find('textarea').setValue('I would like to join');

    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(applyStub.called).toBe(true);
  });
});
