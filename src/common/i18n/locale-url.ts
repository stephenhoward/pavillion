import { isValidLanguageCode } from '@/common/i18n/languages';

interface LocaleUrlResult {
  locale: string | null;
  path: string;
}

/**
 * Strips a locale prefix from a URL path.
 *
 * Locale-prefixed URLs have the form /{lang-code}/rest-of-path
 * (e.g., /es/@calendar, /fr/events).
 *
 * @param urlPath - The URL path to inspect (should start with '/')
 * @returns Object with the detected locale code (or null) and the remaining path
 */
export function stripLocalePrefix(urlPath: string): LocaleUrlResult {
  const match = urlPath.match(/^\/([a-z]{2,3})(\/.*)$/i);

  if (!match) {
    return { locale: null, path: urlPath };
  }

  const candidate = match[1].toLowerCase();

  if (!isValidLanguageCode(candidate)) {
    return { locale: null, path: urlPath };
  }

  return { locale: candidate, path: match[2] || '/' };
}
