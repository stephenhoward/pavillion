import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { createI18nConfig } from '@/common/i18n/config';

import { readLocaleCookie, writeLocaleCookie } from '@/common/i18n/cookie';
import { isValidLanguageCode, DEFAULT_LANGUAGE_CODE } from '@/common/i18n/languages';

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
 * Detects the best language for the client from available signals.
 *
 * Detection chain (first valid match wins):
 *   1. pavilion_locale cookie
 *   2. Browser navigator.languages preference
 *   3. Instance default (serverLanguage parameter)
 *   4. Hard-coded 'en' fallback
 *
 * @param serverLanguage - Optional instance default language from server settings
 * @returns The best matching supported language code
 */
export function detectLanguage(serverLanguage?: string): string {
  // 1. Cookie preference
  const cookieLocale = readLocaleCookie();
  if (cookieLocale && isValidLanguageCode(cookieLocale)) {
    return cookieLocale;
  }

  // 2. Browser navigator.languages
  const browserLanguages = navigator.languages || (navigator.language ? [navigator.language] : []);
  for (const lang of browserLanguages) {
    // Try exact match first
    if (isValidLanguageCode(lang)) {
      return lang;
    }
    // Try base language (e.g. 'es' from 'es-MX')
    const baseLang = lang.split('-')[0];
    if (isValidLanguageCode(baseLang)) {
      return baseLang;
    }
  }

  // 3. Instance default
  if (serverLanguage && isValidLanguageCode(serverLanguage)) {
    return serverLanguage;
  }

  // 4. Hard-coded English fallback
  return DEFAULT_LANGUAGE_CODE;
}

/**
 * Initializes the i18next internationalization framework with all translation resources.
 * Uses the detection chain (cookie → browser → instance default → 'en') to pick the
 * initial language.
 *
 * @param serverLanguage - Optional language code from server settings (e.g., 'es', 'en')
 * @returns {i18next.i18n} The configured i18next instance
 */
export const initI18Next = (serverLanguage?: string) => {
  const detectedLanguage = detectLanguage(serverLanguage);

  const config = createI18nConfig({
    lng: detectedLanguage,
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
  });

  i18next
    .use(LanguageDetector)
    .init(config);

  return i18next;
};

/**
 * Applies the account's preferred language to i18next if it differs from the
 * currently active language.
 *
 * Called after a user's profile is loaded to ensure the UI matches their stored
 * language preference. Does nothing if the account language is invalid or already
 * matches the current i18next language.
 *
 * @param language - The account's stored language preference code
 */
export async function applyAccountLanguage(language: string): Promise<void> {
  if (!language || !isValidLanguageCode(language)) {
    return;
  }

  if (i18next.language === language) {
    return;
  }

  await i18next.changeLanguage(language);
}

/**
 * Changes the active UI language and persists the choice.
 *
 * Steps (in order):
 *   1. Validate the language code — abort silently if invalid
 *   2. Change i18next language (updates all reactive translations)
 *   3. Write pavilion_locale cookie (persists for future visits)
 *   4. Call persistToApi callback if provided (stores preference server-side)
 *
 * @param language - The language code to switch to (e.g. 'es', 'en')
 * @param persistToApi - Optional async callback to persist the language to the server
 */
export async function changeLanguage(
  language: string,
  persistToApi?: (language: string) => Promise<void>,
): Promise<void> {
  if (!language || !isValidLanguageCode(language)) {
    return;
  }

  await i18next.changeLanguage(language);
  writeLocaleCookie(language);

  if (persistToApi) {
    await persistToApi(language);
  }
}
