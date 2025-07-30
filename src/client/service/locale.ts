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

/**
 * Initializes the i18next internationalization framework with all translation resources.
 * Sets up language detection from the browser and configures fallback language to English.
 *
 * @returns {i18next.i18n} The configured i18next instance
 */
export const initI18Next = () => {
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
        },
      },
      detection: {
        order: ['navigator'],
        caches: ['localStorage'],
      },
    });

  return i18next;
};
