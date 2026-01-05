import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import English translation resources (widget shares system translations with site)
import enSystem from '@/site/locales/en/system.json';

/**
 * Initializes the i18next internationalization framework for the widget app.
 * Uses browser language detection and falls back to English.
 *
 * @returns The configured i18next instance
 */
export const initI18Next = () => {
  i18next
    .use(LanguageDetector)
    .init({
      debug: process.env.NODE_ENV === 'development',
      fallbackLng: 'en',
      resources: {
        en: {
          system: enSystem,
        },
      },
      detection: {
        order: ['navigator'],
        caches: ['localStorage'],
      },
    });

  return i18next;
};
