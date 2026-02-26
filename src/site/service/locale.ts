import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { createI18nConfig } from '@/common/i18n/config';

// Import translation resources
import enSystem from '@/site/locales/en/system.json';
import esSystem from '@/site/locales/es/system.json';
import frSystem from '@/site/locales/fr/system.json';

/**
 * Initializes the i18next internationalization framework with all translation resources.
 * Sets up language detection from the browser and configures fallback language to English.
 *
 * Returns a Promise that resolves once i18next is fully initialized, allowing callers
 * to await initialization before mounting the Vue app to prevent a flash of English
 * content on non-default locale pages.
 *
 * @returns {Promise<i18next.i18n>} Resolves to the configured i18next instance
 */
export const initI18Next = (): Promise<typeof i18next> => {
  return i18next
    .use(LanguageDetector)
    .init(createI18nConfig({
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
      detection: {
        order: ['navigator'],
      },
    }))
    .then(() => i18next);
};
