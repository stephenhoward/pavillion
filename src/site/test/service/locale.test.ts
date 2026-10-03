import { describe, it, expect, beforeAll } from 'vitest';
import i18next from 'i18next';

import { AVAILABLE_LANGUAGES } from '@/common/i18n/languages';
import { initI18Next } from '@/site/service/locale';

/**
 * Namespaces the site must register for every language in AVAILABLE_LANGUAGES.
 * `ui` is the shared-component namespace owned by src/common/ui; a language
 * missing it renders shared calendar views in English on an otherwise
 * translated page.
 */
const REQUIRED_NAMESPACES = ['system', 'ui'];

const LANGUAGE_CODES = AVAILABLE_LANGUAGES.map(language => language.code);

describe('site locale service', () => {
  beforeAll(async () => {
    await initI18Next();
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

  it('resolves a ui key in Spanish rather than falling back to English', () => {
    expect(i18next.getFixedT('es', 'ui')('view_week')).toBe('Semana');
  });

  it('selects the plural form of a ui key from count', () => {
    const t = i18next.getFixedT('fr', 'ui');
    expect(t('more_events', { count: 1 })).toBe('1 autre événement');
    expect(t('more_events', { count: 3 })).toBe('3 autres événements');
  });
});
