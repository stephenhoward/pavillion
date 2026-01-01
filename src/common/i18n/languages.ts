/**
 * Defines the available UI languages for the Pavillion application.
 *
 * This is the single source of truth for supported languages.
 * To add a new language:
 * 1. Add the language code and native name here
 * 2. Create translation files in src/client/locales/{code}/
 * 3. Create translation files in src/site/locales/{code}/
 * 4. Create translation files in src/server/locales/{code}/
 * 5. Update locale initialization in src/client/service/locale.ts
 * 6. Update locale initialization in src/site/service/locale.ts
 */

export interface Language {
  /** ISO 639-1 language code (e.g., 'en', 'es', 'fr') */
  code: string;
  /** Language name in its native script (e.g., 'English', 'Español') */
  nativeName: string;
}

/**
 * List of languages with complete UI translations.
 * Languages are ordered by code for consistency.
 */
export const AVAILABLE_LANGUAGES: Language[] = [
  { code: 'en', nativeName: 'English' },
  { code: 'es', nativeName: 'Español' },
  // Add new languages here as translations become available:
  // { code: 'fr', nativeName: 'Français' },
  // { code: 'de', nativeName: 'Deutsch' },
  // { code: 'pt', nativeName: 'Português' },
  // { code: 'ja', nativeName: '日本語' },
  // { code: 'zh', nativeName: '中文' },
];

/**
 * Default language code used when no preference is set.
 */
export const DEFAULT_LANGUAGE_CODE = 'en';

/**
 * Checks if a language code is supported.
 */
export function isValidLanguageCode(code: string): boolean {
  return AVAILABLE_LANGUAGES.some(lang => lang.code === code);
}

/**
 * Gets the language object for a given code.
 * Returns undefined if the code is not supported.
 */
export function getLanguage(code: string): Language | undefined {
  return AVAILABLE_LANGUAGES.find(lang => lang.code === code);
}

/**
 * Detects the browser's preferred language and returns the best matching
 * supported language code. Falls back to DEFAULT_LANGUAGE_CODE if no match.
 */
export function getBrowserLanguage(): string {
  // Get browser languages (e.g., ['es-MX', 'es', 'en-US', 'en'])
  const browserLanguages = navigator.languages || [navigator.language];

  for (const lang of browserLanguages) {
    // First try exact match (e.g., 'es')
    if (isValidLanguageCode(lang)) {
      return lang;
    }
    // Then try base language (e.g., 'es' from 'es-MX')
    const baseLang = lang.split('-')[0];
    if (isValidLanguageCode(baseLang)) {
      return baseLang;
    }
  }

  return DEFAULT_LANGUAGE_CODE;
}
