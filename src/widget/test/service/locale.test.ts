import { describe, it, expect, beforeAll } from 'vitest';
import i18next from 'i18next';

import { AVAILABLE_LANGUAGES } from '@/common/i18n/languages';
import { initI18Next } from '@/widget/service/locale';

/**
 * Namespaces the widget must register for every language in AVAILABLE_LANGUAGES.
 * Adding a language to AVAILABLE_LANGUAGES without wiring its bundles here fails
 * these tests rather than silently serving English to that language's visitors.
 */
const REQUIRED_NAMESPACES = ['system'];

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
    expect(i18next.t('system:previous_week')).toBe('Semana anterior');
  });
});
