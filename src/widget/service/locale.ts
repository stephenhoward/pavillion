import i18next from 'i18next';
import { createI18nConfig } from '@/common/i18n/config';

// Import translation resources (widget shares system translations with site)
import enSystem from '@/site/locales/en/system.json';
import esSystem from '@/site/locales/es/system.json';
import frSystem from '@/site/locales/fr/system.json';

/**
 * Initializes the i18next internationalization framework for the widget app.
 * Uses the language resolved by the widget SDK (passed via URL parameter),
 * with a fallback to English.
 *
 * Language detection is handled by the widget SDK before the iframe is created.
 * The resolved language is passed to the widget iframe via the `lang` URL parameter.
 *
 * @param language - The language code resolved by the widget SDK
 * @returns The configured i18next instance
 */
export const initI18Next = (language?: string) => {
  i18next
    .init(createI18nConfig({
      ...(language ? { lng: language } : {}),
      resources: {
        en: {
          system: enSystem,
        },
        es: {
          system: esSystem,
        },
        fr: {
          system: frSystem,
        },
      },
    }));

  return i18next;
};
