import { expect, describe, it, beforeAll, afterAll } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import i18next from 'i18next';

import { mountComponent } from '@/client/test/lib/vue';
import { initI18Next } from '@/client/service/locale';
import InstancePolicy from '@/client/components/logged_out/instance-policy.vue';

const routes: RouteRecordRaw[] = [
  { path: '/login', component: {}, name: 'login' },
  { path: '/policy', component: {}, name: 'instance-policy' },
];

const mountInstancePolicy = async (settings: Record<string, unknown> = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  await router.push('/policy');
  await router.isReady();
  const wrapper = mountComponent(InstancePolicy, router, {
    provide: {
      site_config: {
        settings: () => settings,
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

  it('renders the current-language policy when present', async () => {
    await i18next.changeLanguage('en');
    const { wrapper } = await mountInstancePolicy({
      instancePolicy: {
        en: '<p>English policy content</p>',
        es: '<p>Spanish policy content</p>',
      },
      defaultLanguage: 'en',
    });

    const article = wrapper.find('article.policy-content');
    expect(article.exists()).toBe(true);
    expect(article.text()).toContain('English policy content');
    expect(article.text()).not.toContain('Spanish policy content');
  });

  it('falls back to instance default language when current language is missing', async () => {
    await i18next.changeLanguage('fr');
    const { wrapper } = await mountInstancePolicy({
      instancePolicy: {
        en: '<p>English policy content</p>',
      },
      defaultLanguage: 'en',
    });

    const article = wrapper.find('article.policy-content');
    expect(article.exists()).toBe(true);
    expect(article.text()).toContain('English policy content');
  });

  it('renders the empty-fallback message when instancePolicy is empty', async () => {
    await i18next.changeLanguage('en');
    const { wrapper } = await mountInstancePolicy({
      instancePolicy: {},
      defaultLanguage: 'en',
    });

    const article = wrapper.find('article.policy-content');
    expect(article.exists()).toBe(true);
    const emptyFallback = i18next.t('policy:empty_fallback');
    expect(article.text()).toContain(emptyFallback);
  });
});
