import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import i18next from 'i18next';

import { AVAILABLE_LANGUAGES } from '@/common/i18n/languages';
import { initI18Next } from '@/widget/service/locale';

/**
 * Namespaces the widget must register for every language in AVAILABLE_LANGUAGES.
 * Adding a language to AVAILABLE_LANGUAGES without wiring its bundles here fails
 * these tests rather than silently serving English to that language's visitors.
 * `ui` is the shared-component namespace owned by src/common/ui.
 */
const REQUIRED_NAMESPACES = ['system', 'ui'];

const LANGUAGE_CODES = AVAILABLE_LANGUAGES.map(language => language.code);

describe('widget locale service', () => {
  beforeAll(() => {
    // The widget SDK passes the resolved language via the `lang` URL parameter;
    // initialize with a non-default one so fallback-to-English is observable.
    initI18Next('es');
  });

  describe.each(REQUIRED_NAMESPACES)('%s namespace', (namespace) => {
    it.each(LANGUAGE_CODES)('is registered with translations for %s', (code) => {
      expect(i18next.hasResourceBundle(code, namespace)).toBe(true);

      // A bundle wired to an empty or swapped object registers but translates
      // nothing, so assert content as well as presence.
      const bundle = i18next.getResourceBundle(code, namespace);
      expect(Object.keys(bundle ?? {}).length).toBeGreaterThan(0);
    });
  });

  it('resolves a system key in the requested language instead of falling back to English', () => {
    expect(i18next.t('system:loading_events')).toBe('Cargando eventos...');
  });

  it('resolves a ui key in the requested language instead of falling back to English', () => {
    expect(i18next.t('ui:view_week')).toBe('Semana');
  });

  describe('document language', () => {
    afterEach(async () => {
      await i18next.changeLanguage('es');
    });

    it('sets <html lang> to the language the widget renders in', () => {
      // WCAG 3.1.1: screen readers pick pronunciation rules from <html lang>,
      // so it must match the UI language rather than the shell's static 'en'.
      expect(document.documentElement.lang).toBe('es');
    });

    it('updates <html lang> when the active language changes', async () => {
      await i18next.changeLanguage('fr');
      expect(document.documentElement.lang).toBe('fr');
    });

    it('uses the resolved language when given a regional variant', async () => {
      await i18next.changeLanguage('es-MX');
      expect(document.documentElement.lang).toBe('es');
    });
  });

  it('selects the plural form of a ui key from count', () => {
    const t = i18next.getFixedT('fr', 'ui');
    expect(t('more_events', { count: 1 })).toBe('1 autre événement');
    expect(t('more_events', { count: 3 })).toBe('3 autres événements');
  });
});
