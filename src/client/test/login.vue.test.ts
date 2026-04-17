import{ expect, describe, it } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';

import { mountComponent } from '@/client/test/lib/vue';
import Login from '@/client/components/logged_out/login.vue';
import ErrorAlert from '@/client/components/logged_out/error-alert.vue';

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

describe('Login Info Panel', () => {

  const defaultDescription = 'Your community\'s events, all in one place. Browse what\'s happening without an account, or sign in to share your own.';

  describe('default copy fallback', () => {

    it('renders default copy when instanceDescription is undefined', () => {
      const router = createRouter({
        history: createMemoryHistory(),
        routes: routes,
      });
      const wrapper = mountComponent(Login, router, {
        provide: {
          site_config: {
            settings: () => ({}),
          },
        },
      });

      const aside = wrapper.find('aside.welcome-card-info');
      expect(aside.exists()).toBe(true);
      expect(aside.text()).toContain(defaultDescription);
    });

    it('renders default copy when instanceDescription is empty object', () => {
      const router = createRouter({
        history: createMemoryHistory(),
        routes: routes,
      });
      const wrapper = mountComponent(Login, router, {
        provide: {
          site_config: {
            settings: () => ({
              instanceDescription: {},
            }),
          },
        },
      });

      const aside = wrapper.find('aside.welcome-card-info');
      expect(aside.exists()).toBe(true);
      expect(aside.text()).toContain(defaultDescription);
    });
  });

  describe('configured instance description', () => {

    it('renders instance description for current language when configured', () => {
      const router = createRouter({
        history: createMemoryHistory(),
        routes: routes,
      });
      const customDescription = 'Welcome to our community events hub!';
      const wrapper = mountComponent(Login, router, {
        provide: {
          site_config: {
            settings: () => ({
              instanceDescription: {
                en: customDescription,
              },
            }),
          },
        },
      });

      const aside = wrapper.find('aside.welcome-card-info');
      expect(aside.exists()).toBe(true);
      expect(aside.text()).toContain(customDescription);
      expect(aside.text()).not.toContain(defaultDescription);
    });

    it('falls back to defaultLanguage when current language is not in instanceDescription', () => {
      const router = createRouter({
        history: createMemoryHistory(),
        routes: routes,
      });
      // i18next.language is 'en' by default from initI18Next,
      // but we only provide a French description with defaultLanguage set to 'fr'
      const frenchDescription = 'Bienvenue dans notre communaut\u00e9';
      const wrapper = mountComponent(Login, router, {
        provide: {
          site_config: {
            settings: () => ({
              instanceDescription: {
                fr: frenchDescription,
              },
              defaultLanguage: 'fr',
            }),
          },
        },
      });

      const aside = wrapper.find('aside.welcome-card-info');
      expect(aside.exists()).toBe(true);
      expect(aside.text()).toContain(frenchDescription);
      expect(aside.text()).not.toContain(defaultDescription);
    });
  });

  describe('learn more link', () => {

    it('has correct href, target, and rel attributes', () => {
      const router = createRouter({
        history: createMemoryHistory(),
        routes: routes,
      });
      const wrapper = mountComponent(Login, router, {
        provide: {
          site_config: {
            settings: () => ({}),
          },
        },
      });

      const learnMoreLink = wrapper.find('a.learn-more');
      expect(learnMoreLink.exists()).toBe(true);
      expect(learnMoreLink.attributes('href')).toContain('pavillion.social');
      expect(learnMoreLink.attributes('target')).toBe('_blank');
      expect(learnMoreLink.attributes('rel')).toContain('noopener');
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

  it('invalid email format', async () => {
    const { wrapper, router, authn } = mountedLogin();
    let pushStub = sinon.createSandbox().stub(router, 'push');
    let loginStub = sinon.createSandbox().stub(authn, 'login');

    await wrapper.find('input[type="email"]').setValue('not-an-email');
    await wrapper.find('input[type="password"]').setValue('password');

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

    await wrapper.find('input[type="email"]').setValue('user@example.com');
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

    await wrapper.find('input[type="email"]').setValue('user@example.com');
    await wrapper.find('input[type="password"]').setValue('password');

    // Trigger form submission using the submit event
    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(pushStub.called).toBe(false);
    expect(loginStub.called).toBe(true);
  });

  it('failed login renders translated alert text with proper ARIA wiring', async () => {
    const { wrapper, router, authn } = mountedLogin();
    let pushStub = sinon.createSandbox().stub(router, 'push');
    let loginStub = sinon.createSandbox().stub(authn, 'login');

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

    expect(pushStub.called).toBe(false);
  });

  it('successful retry clears both the red field class and the alert element', async () => {
    const { wrapper, router, authn } = mountedLogin();
    sinon.createSandbox().stub(router, 'push');
    let loginStub = sinon.createSandbox().stub(authn, 'login');

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
  });

  it('catch login error', async () => {
    const { wrapper, router, authn } = mountedLogin();
    let pushStub = sinon.createSandbox().stub(router, 'push');
    let loginStub = sinon.createSandbox().stub(authn, 'login');

    loginStub.throws("ouch");

    await wrapper.find('input[type="email"]').setValue('user@example.com');
    await wrapper.find('input[type="password"]').setValue('password');

    // Trigger form submission using the submit event
    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(pushStub.called).toBe(false);
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

  it('login succeeds', async () => {
    const { wrapper, router, authn } = mountedLogin();
    let pushStub = sinon.createSandbox().stub(router, 'push');
    let loginStub = sinon.createSandbox().stub(authn, 'login');

    loginStub.resolves(true);

    await wrapper.find('input[type="email"]').setValue('user@example.com');
    await wrapper.find('input[type="password"]').setValue('password');

    // Trigger form submission using the submit event
    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(pushStub.called).toBe(true);
    expect(loginStub.called).toBe(true);
  });
});
