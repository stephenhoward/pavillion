import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { createI18nConfig } from '@/common/i18n/config';

// Import English translation resources
import enSystem from '@/site/locales/en/system.json';

/**
 * Initializes the i18next internationalization framework with all translation resources.
 * Sets up language detection from the browser and configures fallback language to English.
 *
 * @returns {i18next.i18n} The configured i18next instance
 */
export const initI18Next = () => {
  i18next
    .use(LanguageDetector)
    .init(createI18nConfig({
      resources: {
        en: {
          system: enSystem,
        },
      },
      detection: {
        order: ['navigator'],
      },
    }));

  return i18next;
};
