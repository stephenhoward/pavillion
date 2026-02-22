import { isValidLanguageCode } from '@/common/i18n/languages';

/**
 * Adds a locale prefix to a URL path using the as-needed strategy.
 * The default locale gets no prefix; other locales get a prefix.
 *
 * @param path - The URL path to prefix (e.g., '/@calendar')
 * @param locale - The locale code to add (e.g., 'fr')
 * @param defaultLocale - The default locale code (e.g., 'en')
 * @returns The prefixed path, or the original path if locale matches default
 */
export function addLocalePrefix(path: string, locale: string, defaultLocale: string): string {
  if (locale === defaultLocale) {
    return path;
  }

  // Normalize path to ensure it starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  // Check if path already has this locale prefix to avoid double-prefixing
  const existing = detectLocaleFromPath(normalizedPath);
  if (existing === locale) {
    return normalizedPath;
  }

  // Handle root path
  if (normalizedPath === '/' || normalizedPath === '') {
    return `/${locale}`;
  }

  return `/${locale}${normalizedPath}`;
}

/**
 * Removes a locale prefix from a URL path.
 * Returns the locale found (or null if no valid locale prefix) and the remaining path.
 *
 * @param path - The URL path to strip (e.g., '/fr/@calendar')
 * @returns An object with the detected locale (or null) and the remaining path
 */
export function stripLocalePrefix(path: string): { locale: string | null; path: string } {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  // Match an optional locale segment at the start: /xx/... or /xx (end of path)
  const match = normalizedPath.match(/^\/([a-z]{2,8})(\/.*)?$/i);

  if (!match) {
    return { locale: null, path: normalizedPath };
  }

  const potentialLocale = match[1].toLowerCase();
  const remainingPath = match[2] ?? '/';

  if (!isValidLanguageCode(potentialLocale)) {
    return { locale: null, path: normalizedPath };
  }

  return { locale: potentialLocale, path: remainingPath };
}

/**
 * Detects the locale from a URL path prefix.
 * Returns the locale code if the path starts with a valid locale prefix, or null otherwise.
 *
 * @param path - The URL path to inspect (e.g., '/fr/@calendar')
 * @returns The locale code if detected, null otherwise
 */
export function detectLocaleFromPath(path: string): string | null {
  return stripLocalePrefix(path).locale;
}
