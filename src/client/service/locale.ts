import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import English translation resources
import enSystem from '@/client/locales/en/system.json';
import enAuthentication from '@/client/locales/en/authentication.json';
import enRegistration from '@/client/locales/en/registration.json';
import enCalendars from '@/client/locales/en/calendars.json';
import enEditEvent from '@/client/locales/en/event_editor.json';
import enProfile from '@/client/locales/en/profile.json';
import enAdmin from '@/client/locales/en/admin.json';
import enInbox from '@/client/locales/en/inbox.json';
import enFeed from '@/client/locales/en/feed.json';
import enMedia from '@/client/locales/en/media.json';
import enCategories from '@/client/locales/en/categories.json';
import enSetup from '@/client/locales/en/setup.json';

// Import Spanish translation resources
import esSystem from '@/client/locales/es/system.json';
import esAuthentication from '@/client/locales/es/authentication.json';
import esSetup from '@/client/locales/es/setup.json';

/**
 * Initializes the i18next internationalization framework with all translation resources.
 * Sets up language detection with localStorage taking priority, then browser settings.
 * The server's configured default language can be passed to override detection.
 *
 * @param serverLanguage - Optional language code from server settings (e.g., 'es', 'en')
 * @returns {i18next.i18n} The configured i18next instance
 */
export const initI18Next = (serverLanguage?: string) => {
  // If server provides a default language, store it in localStorage for future visits
  if (serverLanguage) {
    localStorage.setItem('i18nextLng', serverLanguage);
  }

  // Initialize i18next with the standard initialization method
  i18next
    .use(LanguageDetector)
    .init({
      debug: process.env.NODE_ENV === 'development',
      fallbackLng: 'en',
      resources: {
        en: {
          system: enSystem,
          authentication: enAuthentication,
          registration: enRegistration,
          calendars: enCalendars,
          event_editor: enEditEvent,
          profile: enProfile,
          admin: enAdmin,
          inbox: enInbox,
          feed: enFeed,
          media: enMedia,
          categories: enCategories,
          setup: enSetup,
        },
        es: {
          system: esSystem,
          authentication: esAuthentication,
          setup: esSetup,
        },
      },
      detection: {
        order: ['localStorage', 'navigator'],
        caches: ['localStorage'],
        lookupLocalStorage: 'i18nextLng',
      },
    });

  return i18next;
};
