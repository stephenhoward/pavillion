import { describe, it, expect } from 'vitest';

import { uiResources } from '@/common/ui/locales';
import { AVAILABLE_LANGUAGES } from '@/common/i18n/languages';

/**
 * Parity guard for the shared `ui` namespace.
 *
 * Shared components own their keys (see ../README.md), so every app that
 * mounts one renders whatever these bundles say. A key added to English but
 * not to Spanish or French does not fail anywhere else: i18next quietly falls
 * back to English and the visitor sees one untranslated label in an otherwise
 * translated view. This test fails instead.
 */

const LANGUAGE_CODES = AVAILABLE_LANGUAGES.map(language => language.code);

describe('ui namespace bundles', () => {
  it('provides a bundle for every available language', () => {
    expect(Object.keys(uiResources).sort()).toEqual([...LANGUAGE_CODES].sort());
  });

  describe.each(LANGUAGE_CODES)('%s', (code) => {
    const bundle = (uiResources as Record<string, { ui: Record<string, string> }>)[code].ui;

    it('has exactly the same keys as English', () => {
      expect(Object.keys(bundle).sort()).toEqual(Object.keys(uiResources.en.ui).sort());
    });

    it('has a non-empty string for every key', () => {
      for (const [key, value] of Object.entries(bundle)) {
        expect(typeof value, key).toBe('string');
        expect(value.trim(), key).not.toBe('');
      }
    });

    it('interpolates {{count}} in both plural forms of more_events', () => {
      expect(bundle.more_events_one).toContain('{{count}}');
      expect(bundle.more_events_other).toContain('{{count}}');
    });
  });
});
