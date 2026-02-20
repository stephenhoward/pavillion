/**
 * Defines the available UI languages for the Pavillion application.
 *
 * This is the single source of truth for supported languages.
 * To add a new language:
 * 1. Add the language entry to AVAILABLE_LANGUAGES below
 * 2. Create translation files in src/client/locales/{code}/
 * 3. Create translation files in src/site/locales/{code}/
 * 4. Create translation files in src/server/locales/{code}/
 * 5. Update locale initialization in src/client/service/locale.ts
 * 6. Update locale initialization in src/site/service/locale.ts
 */

/**
 * Completeness category for a language's translation coverage.
 * - 'primary': translations are substantially complete (>= PRIMARY_THRESHOLD)
 * - 'beta': translations are partially complete (>= BETA_THRESHOLD)
 * - 'incomplete': translations are below beta threshold
 */
export type LanguageCompleteness = 'primary' | 'beta' | 'incomplete';

/**
 * Minimum fraction of strings translated for a language to be considered primary.
 */
export const PRIMARY_THRESHOLD = 0.8;

/**
 * Minimum fraction of strings translated for a language to be considered beta.
 */
export const BETA_THRESHOLD = 0.5;

export interface Language {
  /** ISO 639-1 language code (e.g., 'en', 'es', 'fr') */
  code: string;
  /** Language name in its native script (e.g., 'English', 'Español') */
  nativeName: string;
  /**
   * Ordered list of fallback language codes to try when a string is missing
   * in this language. The list ends with 'en' as the ultimate fallback.
   * Example: ['es', 'en'] means try Spanish then English.
   */
  fallbackChain: string[];
  /**
   * Text direction for this language.
   * 'ltr' = left-to-right, 'rtl' = right-to-left.
   */
  direction: 'ltr' | 'rtl';
}

/**
 * List of languages supported by Pavillion.
 * This is the single source of truth — do not define language metadata anywhere else.
 *
 * Fallback chain conventions:
 * - Closely related languages fall back to each other before falling back to English.
 * - Every chain ends with 'en' (the ultimate fallback).
 * - English itself has an empty fallback chain.
 */
export const AVAILABLE_LANGUAGES: Language[] = [
  {
    code: 'en',
    nativeName: 'English',
    fallbackChain: [],
    direction: 'ltr',
  },
  {
    code: 'es',
    nativeName: 'Español',
    fallbackChain: ['en'],
    direction: 'ltr',
  },
  // Add new languages here as translations become available.
  // Examples of how fallback chains should be structured:
  // {
  //   code: 'pt',
  //   nativeName: 'Português',
  //   fallbackChain: ['es', 'en'],   // Portuguese → Spanish → English
  //   direction: 'ltr',
  // },
  // {
  //   code: 'fr',
  //   nativeName: 'Français',
  //   fallbackChain: ['en'],
  //   direction: 'ltr',
  // },
  // {
  //   code: 'de',
  //   nativeName: 'Deutsch',
  //   fallbackChain: ['en'],
  //   direction: 'ltr',
  // },
  // {
  //   code: 'ja',
  //   nativeName: '日本語',
  //   fallbackChain: ['en'],
  //   direction: 'ltr',
  // },
  // {
  //   code: 'zh',
  //   nativeName: '中文',
  //   fallbackChain: ['en'],
  //   direction: 'ltr',
  // },
  // {
  //   code: 'ar',
  //   nativeName: 'العربية',
  //   fallbackChain: ['en'],
  //   direction: 'rtl',
  // },
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
 * Returns the completeness category for the given locale based on its
 * translation coverage relative to PRIMARY_THRESHOLD and BETA_THRESHOLD.
 *
 * This is a stub — actual completeness values will be injected at build time
 * or provided via a completeness data file once translation tooling is in place.
 *
 * Current behaviour:
 * - 'en' is always 'primary' (it is the source language).
 * - All other supported languages default to 'beta' until real data is available.
 * - Unsupported language codes return 'incomplete'.
 */
export function getLanguageCompleteness(locale: string): LanguageCompleteness {
  if (locale === 'en') {
    return 'primary';
  }

  if (isValidLanguageCode(locale)) {
    return 'beta';
  }

  return 'incomplete';
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
