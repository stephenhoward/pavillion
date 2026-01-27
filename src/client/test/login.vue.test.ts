import{ expect, describe, it } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';

import { mountComponent } from '@/client/test/lib/vue';
import Login from '@/client/components/logged_out/login.vue';

const routes: RouteRecordRaw[] = [
  { path: '/login',  component: {}, name: 'login', props: true },
  { path: '/logout', component: {}, name: 'logout' },
  { path: '/register', component: {}, name: 'register', props: true },
  { path: '/forgot', component: {}, name: 'forgot_password', props: true },
  { path: '/apply',  component: {}, name: 'register-apply', props: true },
  { path: '/reset',  component: {}, name: 'reset_password', props: true },
];

const mountedLogin = () => {
  let router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });
  let authn = {
    login: async () => {
      return false;
    },
  };

  const wrapper = mountComponent(Login, router, {
    provide: {
      site_config: {
        settings: () => { return {};},
      },
      authn,
    },
  });

  return {
    wrapper,
    router,
    authn,
  };
};

describe('Login Screen', () => {

  let router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });
  const wrapper = mountComponent(Login, router, {
    provide: {
      site_config: {
        settings: () => { return {}; },
      },
    },
  });

  it('should show basic login components', () => {
    expect(wrapper.find('div.error').exists()).toBe(false);
    expect(wrapper.find('input[type="email"]').exists()).toBe(true);
    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    expect(wrapper.find('button[type="submit"]').exists()).toBe(true);

    expect(wrapper.find('#register').exists()).toBe(false);
    expect(wrapper.find('#apply').exists()).toBe(false);
  });

  describe('Closed Registration', () => {
    const closedWrapper = mountComponent(Login, router, {
      provide: {
        site_config: {
          settings: () => {
            return {
              registrationMode: 'closed',
            };
          },
        },
      },
    });
    it('no registration link', () => {
      expect(closedWrapper.find('#register').exists()).toBe(false);
    });

    it('no apply link', () => {
      expect(closedWrapper.find('#apply').exists()).toBe(false);
    });
  });

  describe('Open Registration', () => {
    const openWrapper = mountComponent(Login, router, {
      provide: {
        site_config: {
          settings: () => {
            return {
              registrationMode: 'open',
            };
          },
        },
      },
    });
    it('has registration link', () => {
      const links = openWrapper.findAll('a');
      const registerLink = links.find(a => a.attributes('href')?.includes('/register'));
      expect(registerLink !== undefined).toBe(true);
    });

    it('no apply link', () => {
      expect(openWrapper.find('#apply').exists()).toBe(false);
    });
  });

  describe('Open Applies', () => {
    const applyWrapper = mountComponent(Login, router, {
      provide: {
        site_config: {
          settings: () => {
            return {
              registrationMode: 'apply',
            };
          },
        },
      },
    });
    it('no registration link', () => {
      expect(applyWrapper.find('#register').exists()).toBe(false);
    });

    it('has apply link', () => {
      const links = applyWrapper.findAll('a');
      const applyLink = links.find(a => a.attributes('href')?.includes('/apply'));
      expect(applyLink !== undefined).toBe(true);
    });
  });

  describe('Invitation Mode', () => {
    const invitationWrapper = mountComponent(Login, router, {
      provide: {
        site_config: {
          settings: () => {
            return {
              registrationMode: 'invitation',
            };
          },
        },
      },
    });
    it('no registration link', () => {
      expect(invitationWrapper.find('#register').exists()).toBe(false);
    });

    it('no apply link', () => {
      expect(invitationWrapper.find('#apply').exists()).toBe(false);
    });
  });

});

describe('Login Behavior', () => {

  it('missing email', async () => {
    const { wrapper, router, authn } = mountedLogin();
    let pushStub = sinon.createSandbox().stub(router, 'push');
    let loginStub = sinon.createSandbox().stub(authn, 'login');

    await wrapper.find('input[type="email"]').setValue('');
    await wrapper.find('input[type="password"]').setValue('password');

    // Trigger form submission using the submit event
    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(pushStub.called).toBe(false);
    expect(loginStub.called).toBe(false);
  });

  it('missing password', async () => {
    const { wrapper, router, authn } = mountedLogin();
    let pushStub = sinon.createSandbox().stub(router, 'push');
    let loginStub = sinon.createSandbox().stub(authn, 'login');

    await wrapper.find('input[type="email"]').setValue('email');
    await wrapper.find('input[type="password"]').setValue('');

    // Trigger form submission using the submit event
    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(pushStub.called).toBe(false);
    expect(loginStub.called).toBe(false);
  });


  it('fail login', async () => {
    const { wrapper, router, authn } = mountedLogin();
    let pushStub = sinon.createSandbox().stub(router, 'push');
    let loginStub = sinon.createSandbox().stub(authn, 'login');

    loginStub.resolves(false);

    await wrapper.find('input[type="email"]').setValue('email');
    await wrapper.find('input[type="password"]').setValue('password');

    // Trigger form submission using the submit event
    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(pushStub.called).toBe(false);
    expect(loginStub.called).toBe(true);
  });

  it('catch login error', async () => {
    const { wrapper, router, authn } = mountedLogin();
    let pushStub = sinon.createSandbox().stub(router, 'push');
    let loginStub = sinon.createSandbox().stub(authn, 'login');

    loginStub.throws("ouch");

    await wrapper.find('input[type="email"]').setValue('email');
    await wrapper.find('input[type="password"]').setValue('password');

    // Trigger form submission using the submit event
    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(pushStub.called).toBe(false);
    expect(loginStub.called).toBe(true);
  });

  it('login succeeds', async () => {
    const { wrapper, router, authn } = mountedLogin();
    let pushStub = sinon.createSandbox().stub(router, 'push');
    let loginStub = sinon.createSandbox().stub(authn, 'login');

    loginStub.resolves(true);

    await wrapper.find('input[type="email"]').setValue('email');
    await wrapper.find('input[type="password"]').setValue('password');

    // Trigger form submission using the submit event
    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(pushStub.called).toBe(true);
    expect(loginStub.called).toBe(true);
  });
});
