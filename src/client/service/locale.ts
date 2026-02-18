import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { createI18nConfig } from '@/common/i18n/config';

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
import enSubscription from '@/client/locales/en/subscription.json';

// Import Spanish translation resources
import esSystem from '@/client/locales/es/system.json';
import esAuthentication from '@/client/locales/es/authentication.json';
import esSetup from '@/client/locales/es/setup.json';

/**
 * Initializes the i18next internationalization framework with all translation resources.
 * Sets up language detection from the browser, with an optional server-configured
 * default language that takes priority over browser detection.
 *
 * @param serverLanguage - Optional language code from server settings (e.g., 'es', 'en')
 * @returns {i18next.i18n} The configured i18next instance
 */
export const initI18Next = (serverLanguage?: string) => {
  i18next
    .use(LanguageDetector)
    .init(createI18nConfig({
      ...(serverLanguage ? { lng: serverLanguage } : {}),
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
          subscription: enSubscription,
        },
        es: {
          system: esSystem,
          authentication: esAuthentication,
          setup: esSetup,
        },
      },
      detection: {
        order: ['navigator'],
      },
    }));

  return i18next;
};
