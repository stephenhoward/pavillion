import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import English translation resources
import enSystem from '@/client/locale/en/system.json';
import enAuthentication from '@/client/locale/en/authentication.json';
import enRegistration from '@/client/locale/en/registration.json';
import enCalendars from '@/client/locale/en/calendars.json';
import enEditEvent from '@/client/locale/en/event_editor.json';
import enProfile from '@/client/locale/en/profile.json';

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
          profile: enProfile
        }
      },
      detection: {
        order: ['navigator'],
        caches: ['localStorage'],
      }
    });
  
  return i18next;
};