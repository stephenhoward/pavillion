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

  it('renders the current-language policy markdown when present', async () => {
    await i18next.changeLanguage('en');
    const { wrapper } = await mountInstancePolicy({
      instancePolicy: {
        en: '## English Heading\n\nEnglish policy paragraph with [link](https://example.com).\n\n- first bullet\n- second bullet',
        es: '## Encabezado\n\nContenido en español.',
      },
      defaultLanguage: 'en',
    });

    const article = wrapper.find('article.policy-content');
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
    const { wrapper } = await mountInstancePolicy({
      instancePolicy: {
        en: '## Default Heading\n\nDefault language policy content.',
      },
      defaultLanguage: 'en',
    });

    const article = wrapper.find('article.policy-content');
    expect(article.exists()).toBe(true);

    const heading = article.find('h2');
    expect(heading.exists()).toBe(true);
    expect(heading.text()).toBe('Default Heading');
    expect(article.find('p').text()).toContain('Default language policy content');
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

  it('strips dangerous payloads at render time (DOMPurify defense-in-depth)', async () => {
    await i18next.changeLanguage('en');
    const { wrapper } = await mountInstancePolicy({
      instancePolicy: {
        en: '## Safe Heading\n\n<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[bad](javascript:alert(1))',
      },
      defaultLanguage: 'en',
    });

    const article = wrapper.find('article.policy-content');
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
