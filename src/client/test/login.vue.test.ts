import { expect, describe, it, afterEach } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';

import { mountComponent } from '@/client/test/lib/vue';
import Login from '@/client/components/logged_out/login.vue';
import LoginForm from '@/client/components/logged_out/LoginForm.vue';

const routes: RouteRecordRaw[] = [
  { path: '/login',  component: {}, name: 'login', props: true },
  { path: '/logout', component: {}, name: 'logout' },
  { path: '/register', component: {}, name: 'register', props: true },
  { path: '/forgot', component: {}, name: 'forgot_password', props: true },
  { path: '/apply',  component: {}, name: 'register-apply', props: true },
  { path: '/reset',  component: {}, name: 'reset_password', props: true },
  { path: '/calendar', component: {}, name: 'calendar' },
];

const mountLoginView = async (settings: Record<string, any> = {}, queryEmail?: string) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });
  if (queryEmail !== undefined) {
    await router.push({ path: '/login', query: { email: queryEmail } });
  }
  else {
    await router.push('/login');
  }
  await router.isReady();
  const authn = {
    login: async () => false,
  };
  const wrapper = mountComponent(Login, router, {
    provide: {
      site_config: {
        settings: () => settings,
      },
      authn,
    },
  });
  return { wrapper, router, authn };
};

describe('Login Route View', () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());

  it('renders the welcome-card layout', async () => {
    const { wrapper } = await mountLoginView();
    expect(wrapper.find('.welcome-card').exists()).toBe(true);
    expect(wrapper.find('aside.welcome-card-info').exists()).toBe(true);
    expect(wrapper.findComponent(LoginForm).exists()).toBe(true);
  });

  it('forwards ?email= query param to LoginForm as initialEmail', async () => {
    const { wrapper } = await mountLoginView({}, 'someone@example.com');
    const form = wrapper.findComponent(LoginForm);
    expect(form.props('initialEmail')).toBe('someone@example.com');
    // Verify input is actually preseeded
    const emailInput = wrapper.find('input[type="email"]');
    expect((emailInput.element as HTMLInputElement).value).toBe('someone@example.com');
  });

  it('passes empty initialEmail when ?email= is not set', async () => {
    const { wrapper } = await mountLoginView();
    const form = wrapper.findComponent(LoginForm);
    // Route passes undefined; LoginForm default coerces to ''
    expect(form.props('initialEmail')).toBe('');
    const emailInput = wrapper.find('input[type="email"]');
    expect((emailInput.element as HTMLInputElement).value).toBe('');
  });

  it('navigates to /calendar when LoginForm emits success', async () => {
    const { wrapper, router } = await mountLoginView();
    const pushStub = sandbox.stub(router, 'push');

    const form = wrapper.findComponent(LoginForm);
    form.vm.$emit('success');
    await wrapper.vm.$nextTick();

    expect(pushStub.calledWith('/calendar')).toBe(true);
  });
});

describe('Login Info Panel', () => {

  const defaultDescription = 'Your community\'s events, all in one place. Browse what\'s happening without an account, or sign in to share your own.';

  describe('default copy fallback', () => {

    it('renders default copy when instanceDescription is undefined', async () => {
      const { wrapper } = await mountLoginView({});

      const aside = wrapper.find('aside.welcome-card-info');
      expect(aside.exists()).toBe(true);
      expect(aside.text()).toContain(defaultDescription);
    });

    it('renders default copy when instanceDescription is empty object', async () => {
      const { wrapper } = await mountLoginView({ instanceDescription: {} });

      const aside = wrapper.find('aside.welcome-card-info');
      expect(aside.exists()).toBe(true);
      expect(aside.text()).toContain(defaultDescription);
    });
  });

  describe('configured instance description', () => {

    it('renders instance description for current language when configured', async () => {
      const customDescription = 'Welcome to our community events hub!';
      const { wrapper } = await mountLoginView({
        instanceDescription: {
          en: customDescription,
        },
      });

      const aside = wrapper.find('aside.welcome-card-info');
      expect(aside.exists()).toBe(true);
      expect(aside.text()).toContain(customDescription);
      expect(aside.text()).not.toContain(defaultDescription);
    });

    it('falls back to defaultLanguage when current language is not in instanceDescription', async () => {
      // i18next.language is 'en' by default from initI18Next,
      // but we only provide a French description with defaultLanguage set to 'fr'
      const frenchDescription = 'Bienvenue dans notre communauté';
      const { wrapper } = await mountLoginView({
        instanceDescription: {
          fr: frenchDescription,
        },
        defaultLanguage: 'fr',
      });

      const aside = wrapper.find('aside.welcome-card-info');
      expect(aside.exists()).toBe(true);
      expect(aside.text()).toContain(frenchDescription);
      expect(aside.text()).not.toContain(defaultDescription);
    });
  });

  describe('learn more link', () => {

    it('has correct href, target, and rel attributes', async () => {
      const { wrapper } = await mountLoginView({});

      const learnMoreLink = wrapper.find('a.learn-more');
      expect(learnMoreLink.exists()).toBe(true);
      expect(learnMoreLink.attributes('href')).toContain('pavillion.social');
      expect(learnMoreLink.attributes('target')).toBe('_blank');
      expect(learnMoreLink.attributes('rel')).toContain('noopener');
    });
  });
});
