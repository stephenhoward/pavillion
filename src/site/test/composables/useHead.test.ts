/**
 * Tests for the useHead composable and its helper functions.
 *
 * Validates that:
 * - getEnabledLanguageCodes() returns codes for all available languages
 * - buildHreflangLinks() generates correct link objects including x-default
 * - useHead() inserts hreflang tags on mount and updates them on navigation
 * - useHead() replaces existing tags rather than duplicating them
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';

// ---------------------------------------------------------------------------
// Mocks — declared before the module under test is imported.
// vi.mock() is hoisted so we cannot reference variables defined above it;
// all mock data must be defined inline inside the factory.
// ---------------------------------------------------------------------------

vi.mock('@/common/i18n/languages', () => {
  const languages = [
    { code: 'en', nativeName: 'English', fallbackChain: [], direction: 'ltr' },
    { code: 'es', nativeName: 'Español', fallbackChain: ['en'], direction: 'ltr' },
    { code: 'fr', nativeName: 'Français', fallbackChain: ['en'], direction: 'ltr' },
    { code: 'de', nativeName: 'Deutsch', fallbackChain: ['en'], direction: 'ltr' },
  ];

  return {
    AVAILABLE_LANGUAGES: languages,
    DEFAULT_LANGUAGE_CODE: 'en',
    // isValidLanguageCode is called by stripLocalePrefix in locale-url.ts
    isValidLanguageCode: (code: string) => languages.some((l: { code: string }) => l.code === code),
  };
});

// ---------------------------------------------------------------------------
// Module under test — imported after mocks are in place
// ---------------------------------------------------------------------------
import { getEnabledLanguageCodes, buildHreflangLinks, useHead } from '@/site/composables/useHead';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal router with the given initial path. */
function makeRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) },
    ],
  });
}

/** Collects all hreflang link elements currently in document.head. */
function collectHreflangLinks(): { hreflang: string; href: string }[] {
  const els = document.head.querySelectorAll('link[rel="alternate"][hreflang]');
  return Array.from(els).map(el => ({
    hreflang: (el as HTMLLinkElement).hreflang,
    href: (el as HTMLLinkElement).href,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getEnabledLanguageCodes', () => {
  it('returns codes for all available languages', () => {
    const codes = getEnabledLanguageCodes();

    expect(codes).toEqual(['en', 'es', 'fr', 'de']);
  });
});

describe('buildHreflangLinks', () => {
  it('returns one link per enabled language plus x-default', () => {
    const links = buildHreflangLinks('/@calendar', 'en', 'https://example.com');

    // 4 enabled languages + x-default
    expect(links).toHaveLength(5);
  });

  it('generates correct href for the default language (no prefix)', () => {
    const links = buildHreflangLinks('/@calendar', 'en', 'https://example.com');
    const en = links.find(l => l.hreflang === 'en');

    expect(en?.href).toBe('https://example.com/@calendar');
  });

  it('generates correct href for a non-default language (with prefix)', () => {
    const links = buildHreflangLinks('/@calendar', 'en', 'https://example.com');
    const es = links.find(l => l.hreflang === 'es');

    expect(es?.href).toBe('https://example.com/es/@calendar');
  });

  it('includes x-default pointing to the unprefixed (default locale) URL', () => {
    const links = buildHreflangLinks('/@calendar', 'en', 'https://example.com');
    const xDefault = links.find(l => l.hreflang === 'x-default');

    expect(xDefault?.href).toBe('https://example.com/@calendar');
  });

  it('handles a non-English default locale', () => {
    const links = buildHreflangLinks('/@calendar', 'es', 'https://example.com');
    const es = links.find(l => l.hreflang === 'es');
    const en = links.find(l => l.hreflang === 'en');
    const xDefault = links.find(l => l.hreflang === 'x-default');

    // es is the default — no prefix
    expect(es?.href).toBe('https://example.com/@calendar');
    // en is non-default — prefixed
    expect(en?.href).toBe('https://example.com/en/@calendar');
    // x-default still points to the unprefixed URL
    expect(xDefault?.href).toBe('https://example.com/@calendar');
  });

  it('handles a root canonical path', () => {
    const links = buildHreflangLinks('/', 'en', 'https://example.com');
    const es = links.find(l => l.hreflang === 'es');

    expect(es?.href).toBe('https://example.com/es');
  });
});

describe('useHead composable', () => {
  let router: ReturnType<typeof makeRouter>;

  beforeEach(async () => {
    // Clear any lingering hreflang tags from previous tests
    document.head.querySelectorAll('link[rel="alternate"][hreflang]').forEach(el => el.remove());

    router = makeRouter();
    await router.push('/@calendar');
    await router.isReady();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.head.querySelectorAll('link[rel="alternate"][hreflang]').forEach(el => el.remove());
  });

  it('inserts hreflang tags on mount', async () => {
    const TestComponent = defineComponent({
      setup() {
        useHead('en', 'https://example.com');
      },
      template: '<div />',
    });

    mount(TestComponent, { global: { plugins: [router] } });
    await nextTick();

    const links = collectHreflangLinks();
    expect(links.length).toBeGreaterThan(0);
  });

  it('inserts a link for each enabled language plus x-default', async () => {
    const TestComponent = defineComponent({
      setup() {
        useHead('en', 'https://example.com');
      },
      template: '<div />',
    });

    mount(TestComponent, { global: { plugins: [router] } });
    await nextTick();

    const links = collectHreflangLinks();
    // 4 enabled languages (en, es, fr, de) + x-default
    expect(links).toHaveLength(5);

    const hreflangs = links.map(l => l.hreflang);
    expect(hreflangs).toContain('en');
    expect(hreflangs).toContain('es');
    expect(hreflangs).toContain('fr');
    expect(hreflangs).toContain('de');
    expect(hreflangs).toContain('x-default');
  });

  it('generates correct hrefs for the current path', async () => {
    const TestComponent = defineComponent({
      setup() {
        useHead('en', 'https://example.com');
      },
      template: '<div />',
    });

    mount(TestComponent, { global: { plugins: [router] } });
    await nextTick();

    const links = collectHreflangLinks();
    const en = links.find(l => l.hreflang === 'en');
    const es = links.find(l => l.hreflang === 'es');
    const xDefault = links.find(l => l.hreflang === 'x-default');

    expect(en?.href).toBe('https://example.com/@calendar');
    expect(es?.href).toBe('https://example.com/es/@calendar');
    expect(xDefault?.href).toBe('https://example.com/@calendar');
  });

  it('updates hreflang tags on SPA navigation', async () => {
    const TestComponent = defineComponent({
      setup() {
        useHead('en', 'https://example.com');
      },
      template: '<div />',
    });

    mount(TestComponent, { global: { plugins: [router] } });
    await nextTick();

    // Navigate to a different calendar page
    await router.push('/@other-calendar');
    await nextTick();

    const links = collectHreflangLinks();
    const en = links.find(l => l.hreflang === 'en');
    const es = links.find(l => l.hreflang === 'es');

    expect(en?.href).toBe('https://example.com/@other-calendar');
    expect(es?.href).toBe('https://example.com/es/@other-calendar');
  });

  it('does not duplicate tags when navigating', async () => {
    const TestComponent = defineComponent({
      setup() {
        useHead('en', 'https://example.com');
      },
      template: '<div />',
    });

    mount(TestComponent, { global: { plugins: [router] } });
    await nextTick();

    await router.push('/@other-calendar');
    await nextTick();

    const links = collectHreflangLinks();
    // Still only 5 links (4 languages + x-default), not 10
    expect(links).toHaveLength(5);
  });

  it('strips the locale prefix from the URL when computing canonical path', async () => {
    await router.push('/es/@calendar');
    await nextTick();

    const TestComponent = defineComponent({
      setup() {
        useHead('en', 'https://example.com');
      },
      template: '<div />',
    });

    mount(TestComponent, { global: { plugins: [router] } });
    await nextTick();

    const links = collectHreflangLinks();
    const en = links.find(l => l.hreflang === 'en');

    // Even though the current URL is /es/@calendar, the canonical path should
    // produce the unprefixed English link
    expect(en?.href).toBe('https://example.com/@calendar');
  });

  it('replaces server-rendered hreflang tags on first navigation', async () => {
    // Simulate server-rendered tags that were inserted into the page on initial load
    const serverTag = document.createElement('link');
    serverTag.rel = 'alternate';
    serverTag.hreflang = 'en';
    serverTag.href = 'https://example.com/@calendar';
    document.head.appendChild(serverTag);

    const TestComponent = defineComponent({
      setup() {
        useHead('en', 'https://example.com');
      },
      template: '<div />',
    });

    mount(TestComponent, { global: { plugins: [router] } });
    await nextTick();

    const links = collectHreflangLinks();
    // The server tag should have been replaced, not duplicated
    const enLinks = links.filter(l => l.hreflang === 'en');
    expect(enLinks).toHaveLength(1);
  });
});
