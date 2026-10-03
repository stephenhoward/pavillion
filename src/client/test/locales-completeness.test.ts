import { describe, it, expect } from 'vitest';

import knownGaps from './fixtures/locale-known-gaps.json';

/**
 * Locale completeness ratchet for every client and site bundle.
 *
 * A key that exists in `en` but is missing from — or blank in — another
 * locale renders as a fallback or an empty string in that language, and
 * nothing else in the suite notices. Both halves are checked: a key-set diff
 * alone passes a present-but-empty value, and an empty-string sweep alone
 * passes an absent key.
 *
 * Today's gaps are recorded in `fixtures/locale-known-gaps.json`, keyed by
 * locale then `<app>/<file>.json`. The baseline only ever shrinks:
 *  - a gap the baseline does not list is a regression and fails;
 *  - a baseline entry that is no longer a gap fails until it is deleted.
 *
 * Bundles are discovered by glob, so a new bundle file or locale is covered
 * without editing this test. Keys present in a locale but absent from `en`
 * are out of scope.
 */

type Bundle = Record<string, unknown>;
type GapBaseline = Record<string, Record<string, string[]>>;

const MODULES = {
  ...import.meta.glob<Bundle>('/src/client/locales/*/*.json', { eager: true, import: 'default' }),
  ...import.meta.glob<Bundle>('/src/site/locales/*/*.json', { eager: true, import: 'default' }),
};

const BASELINE = knownGaps as GapBaseline;

/** Bundles indexed by locale, then by `<app>/<file>.json`. */
const BUNDLES: Record<string, Record<string, Bundle>> = {};
for (const [modulePath, bundle] of Object.entries(MODULES)) {
  const match = modulePath.match(/^\/src\/(client|site)\/locales\/([^/]+)\/([^/]+\.json)$/);
  if (!match) {
    throw new Error(`Unexpected locale bundle path: ${modulePath}`);
  }
  const [, app, locale, file] = match;
  (BUNDLES[locale] ??= {})[`${app}/${file}`] = bundle;
}

/** Flattens nested translation objects into dotted key paths. */
function flatten(bundle: Bundle, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [key, value] of Object.entries(bundle)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value as Bundle, path, out);
    }
    else {
      out[path] = value;
    }
  }
  return out;
}

/** Keys defined in `en` that the locale either lacks or leaves as `""`. */
function gapsFor(en: Bundle, translated: Bundle | undefined): string[] {
  const enKeys = flatten(en);
  const localeKeys = translated ? flatten(translated) : {};
  return Object.keys(enKeys)
    .filter((key) => !(key in localeKeys) || localeKeys[key] === '')
    .sort();
}

const EN_BUNDLES = BUNDLES.en ?? {};
const OTHER_LOCALES = Object.keys(BUNDLES).filter((locale) => locale !== 'en').sort();

describe('locale completeness against en', () => {
  it('discovers en bundles for both the client and site apps', () => {
    const files = Object.keys(EN_BUNDLES);
    expect(files.some((file) => file.startsWith('client/'))).toBe(true);
    expect(files.some((file) => file.startsWith('site/'))).toBe(true);
    expect(OTHER_LOCALES.length).toBeGreaterThan(0);
  });

  it('lists no baseline locale that has no bundles', () => {
    const unknown = Object.keys(BASELINE).filter((locale) => !OTHER_LOCALES.includes(locale));
    expect(unknown, 'locale-known-gaps.json lists locales with no bundles; delete them').toEqual([]);
  });

  for (const locale of OTHER_LOCALES) {
    describe(locale, () => {
      const baseline = BASELINE[locale] ?? {};
      const files = [...new Set([...Object.keys(EN_BUNDLES), ...Object.keys(baseline)])].sort();

      for (const file of files) {
        it(`${file} has no gaps beyond the known-gaps baseline`, () => {
          const en = EN_BUNDLES[file];
          const actual = en ? gapsFor(en, BUNDLES[locale][file]) : [];
          const known = baseline[file] ?? [];

          const regressions = actual.filter((key) => !known.includes(key));
          const resolved = known.filter((key) => !actual.includes(key));

          expect(
            regressions,
            `${locale}/${file}: keys missing or empty compared with en — translate them`,
          ).toEqual([]);
          expect(
            resolved,
            `${locale}/${file}: no longer gaps — delete these from fixtures/locale-known-gaps.json`,
          ).toEqual([]);
        });
      }
    });
  }
});
