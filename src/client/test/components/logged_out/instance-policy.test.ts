import { expect, describe, it, beforeAll, afterAll } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import i18next from 'i18next';

import { mountComponent } from '@/client/test/lib/vue';
import { initI18Next } from '@/client/service/locale';
import InstancePolicy from '@/client/components/logged_out/instance-policy.vue';

const routes: RouteRecordRaw[] = [
  { path: '/login', component: {}, name: 'login' },
  { path: '/auth/register', component: {}, name: 'register' },
  { path: '/auth/apply', component: {}, name: 'register-apply' },
  { path: '/profile', component: {}, name: 'profile' },
  { path: '/policy', component: {}, name: 'instance-policy' },
];

type MountOpts = {
  settings?: Record<string, unknown>;
  policyPath?: string;
  isLoggedIn?: boolean;
};

const mountInstancePolicy = async ({
  settings = {},
  policyPath = '/policy',
  isLoggedIn = false,
}: MountOpts = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  await router.push(policyPath);
  await router.isReady();
  const wrapper = mountComponent(InstancePolicy, router, {
    provide: {
      site_config: {
        settings: () => settings,
      },
      authn: {
        isLoggedIn: () => isLoggedIn,
      },
    },
  });
  return { wrapper, router };
};

describe('InstancePolicy fallback chain', () => {
  let originalLanguage: string;

  beforeAll(() => {
    initI18Next();
    originalLanguage = i18next.language;
  });

  afterAll(async () => {
    await i18next.changeLanguage(originalLanguage);
  });

  it('renders the current-language policy markdown when present', async () => {
    await i18next.changeLanguage('en');
    const { wrapper } = await mountInstancePolicy({ settings: {
      instancePolicy: {
        en: '## English Heading\n\nEnglish policy paragraph with [link](https://example.com).\n\n- first bullet\n- second bullet',
        es: '## Encabezado\n\nContenido en español.',
      },
      defaultLanguage: 'en',
    } });

    const article = wrapper.find('.policy-page__body');
    expect(article.exists()).toBe(true);

    const heading = article.find('h2');
    expect(heading.exists()).toBe(true);
    expect(heading.text()).toBe('English Heading');

    const paragraph = article.find('p');
    expect(paragraph.exists()).toBe(true);
    expect(paragraph.text()).toContain('English policy paragraph');

    const link = article.find('a');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toBe('https://example.com');
    expect(link.text()).toBe('link');

    const bullets = article.findAll('li');
    expect(bullets).toHaveLength(2);
    expect(bullets[0].text()).toBe('first bullet');
    expect(bullets[1].text()).toBe('second bullet');

    expect(article.text()).not.toContain('Encabezado');
    expect(article.text()).not.toContain('español');
  });

  it('falls back to instance default language when current language is missing', async () => {
    await i18next.changeLanguage('fr');
    const { wrapper } = await mountInstancePolicy({ settings: {
      instancePolicy: {
        en: '## Default Heading\n\nDefault language policy content.',
      },
      defaultLanguage: 'en',
    } });

    const article = wrapper.find('.policy-page__body');
    expect(article.exists()).toBe(true);

    const heading = article.find('h2');
    expect(heading.exists()).toBe(true);
    expect(heading.text()).toBe('Default Heading');
    expect(article.find('p').text()).toContain('Default language policy content');
  });

  it('renders the empty-fallback message when instancePolicy is empty', async () => {
    await i18next.changeLanguage('en');
    const { wrapper } = await mountInstancePolicy({ settings: {
      instancePolicy: {},
      defaultLanguage: 'en',
    } });

    const article = wrapper.find('.policy-page__body');
    expect(article.exists()).toBe(true);
    const emptyFallback = i18next.t('policy:empty_fallback');
    expect(article.text()).toContain(emptyFallback);
  });

  it('strips dangerous payloads at render time (DOMPurify defense-in-depth)', async () => {
    await i18next.changeLanguage('en');
    const { wrapper } = await mountInstancePolicy({ settings: {
      instancePolicy: {
        en: '## Safe Heading\n\n<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[bad](javascript:alert(1))',
      },
      defaultLanguage: 'en',
    } });

    const article = wrapper.find('.policy-page__body');
    expect(article.exists()).toBe(true);

    // Safe content survives.
    expect(article.find('h2').text()).toBe('Safe Heading');

    // Dangerous markup is stripped from the rendered HTML.
    const html = article.html();
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
    expect(article.find('script').exists()).toBe(false);
    expect(article.find('img').exists()).toBe(false);
  });
});

describe('InstancePolicy back link', () => {
  beforeAll(() => {
    initI18Next();
  });

  const settings = { instancePolicy: { en: '## ok' }, defaultLanguage: 'en' };

  it('routes back to login when from=login', async () => {
    const { wrapper } = await mountInstancePolicy({ settings, policyPath: '/policy?from=login' });
    const link = wrapper.find('a.policy-page__back');
    expect(link.attributes('href')).toBe('/login');
    expect(link.text()).toContain('sign in');
  });

  it('routes back to register when from=register', async () => {
    const { wrapper } = await mountInstancePolicy({ settings, policyPath: '/policy?from=register' });
    const link = wrapper.find('a.policy-page__back');
    expect(link.attributes('href')).toBe('/auth/register');
    expect(link.text()).toContain('registration');
  });

  it('routes back to the application page when from=register-apply', async () => {
    const { wrapper } = await mountInstancePolicy({ settings, policyPath: '/policy?from=register-apply' });
    const link = wrapper.find('a.policy-page__back');
    expect(link.attributes('href')).toBe('/auth/apply');
    expect(link.text()).toContain('application');
  });

  it('routes back to settings when from=settings', async () => {
    const { wrapper } = await mountInstancePolicy({ settings, policyPath: '/policy?from=settings' });
    const link = wrapper.find('a.policy-page__back');
    expect(link.attributes('href')).toBe('/profile');
    expect(link.text()).toContain('settings');
  });

  it('falls back to settings when no source is given but the visitor is logged in', async () => {
    const { wrapper } = await mountInstancePolicy({ settings, isLoggedIn: true });
    const link = wrapper.find('a.policy-page__back');
    expect(link.attributes('href')).toBe('/profile');
    expect(link.text()).toContain('settings');
  });

  it('falls back to login when no source is given and the visitor is anonymous', async () => {
    const { wrapper } = await mountInstancePolicy({ settings });
    const link = wrapper.find('a.policy-page__back');
    expect(link.attributes('href')).toBe('/login');
    expect(link.text()).toContain('sign in');
  });
});
