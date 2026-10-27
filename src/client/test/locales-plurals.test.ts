import { describe, it, expect } from 'vitest';
import i18next from 'i18next';

/**
 * Locale guard for plural key suffixes.
 *
 * i18next resolves plurals with the JSON-v4 suffixes (`_zero`, `_one`,
 * `_two`, `_few`, `_many`, `_other`). The legacy v3 `_plural` suffix is
 * ignored: a `key` / `key_plural` pair renders the singular `key` for every
 * count, so "0 event" and "2 event" reach the screen with nothing in the
 * component or its mocked-translation tests to notice.
 */

type Bundle = Record<string, unknown>;

const MODULES = {
  ...import.meta.glob<Bundle>('/src/client/locales/*/*.json', { eager: true, import: 'default' }),
  ...import.meta.glob<Bundle>('/src/site/locales/*/*.json', { eager: true, import: 'default' }),
};

/** Flattens nested translation objects into dotted key paths. */
function flattenKeys(bundle: Bundle, prefix = ''): string[] {
  return Object.entries(bundle).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? flattenKeys(value as Bundle, path)
      : [path];
  });
}

/** Renders `key` from one client bundle through a real i18next instance. */
async function render(locale: string, namespace: string, key: string, count: number): Promise<string> {
  const bundle = MODULES[`/src/client/locales/${locale}/${namespace}.json`];
  const instance = i18next.createInstance();
  await instance.init({
    lng: locale,
    ns: [namespace],
    defaultNS: namespace,
    resources: { [locale]: { [namespace]: bundle } },
  });
  return instance.t(key, { count });
}

describe('locale plural suffixes', () => {
  it('uses no legacy `_plural` key in any client or site bundle', () => {
    const legacy = Object.entries(MODULES).flatMap(([path, bundle]) =>
      flattenKeys(bundle)
        .filter((key) => key.endsWith('_plural'))
        .map((key) => `${path}: ${key}`),
    );
    expect(legacy).toEqual([]);
  });

  it.each([
    [0, '0 events'],
    [1, '1 event'],
    [2, '2 events'],
  ])('renders the series event count for %i as "%s"', async (count, expected) => {
    expect(await render('en', 'series', 'management.event_count', count)).toBe(expected);
  });

  it.each([
    [1, '1 instance blocked'],
    [3, '3 instances blocked'],
  ])('renders the blocked instance count for %i as "%s"', async (count, expected) => {
    expect(await render('en', 'admin', 'blocked_instances.list.count', count)).toBe(expected);
  });
});
