import type { InitOptions } from 'i18next';

/**
 * Creates a base i18next configuration merged with the provided overrides.
 * Used by client, site, widget, and server to share common defaults.
 *
 * @param overrides - Partial i18next InitOptions to merge over the base config
 * @returns Full i18next InitOptions ready for .init()
 */
export function createI18nConfig(overrides: InitOptions = {}): InitOptions {
  const base: InitOptions = {
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  };

  return { ...base, ...overrides };
}
