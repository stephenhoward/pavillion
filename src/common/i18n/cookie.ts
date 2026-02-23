/**
 * Cookie utilities for reading and writing the pavilion_locale preference cookie.
 *
 * The cookie is only written when explicitly called — this module does not
 * auto-set any cookies. Callers are responsible for deciding when to persist
 * a locale preference.
 *
 * Browser environment: reads and writes via document.cookie
 * Server environment: callers read via req.cookies['pavilion_locale'] directly
 */

/** The cookie name used to store the user's locale preference. */
export const LOCALE_COOKIE_NAME = 'pavilion_locale';

/** Cookie max-age in seconds: 1 year. */
const COOKIE_MAX_AGE = 31536000;

/**
 * Reads the pavilion_locale cookie value from document.cookie.
 *
 * @returns The stored locale string (e.g. 'en', 'es'), or null if not set.
 */
export function readLocaleCookie(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const cookies = document.cookie.split(';');

  for (const cookie of cookies) {
    const [name, value] = cookie.split('=');

    if (name.trim() === LOCALE_COOKIE_NAME) {
      return value ? decodeURIComponent(value.trim()) : null;
    }
  }

  return null;
}

/**
 * Writes the pavilion_locale cookie with a 1-year expiry.
 *
 * Cookie attributes: SameSite=Lax, max-age=31536000 (1 year).
 * The Secure attribute is added only when the page is served over HTTPS,
 * so that local HTTP development environments do not silently reject the cookie.
 * This function must only be called on explicit user action.
 *
 * This utility does not validate locale codes. Callers should validate
 * against AVAILABLE_LANGUAGES (via isValidLanguageCode) before writing.
 * Note that isValidLanguageCode only accepts base codes ('en', 'es'), not
 * region subtags ('en-US', 'zh-TW').
 *
 * @param locale - The locale code to store (e.g. 'en', 'es').
 */
export function writeLocaleCookie(locale: string): void {
  if (typeof document === 'undefined') {
    return;
  }

  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const secureAttr = isHttps ? '; Secure' : '';
  const encoded = encodeURIComponent(locale);
  document.cookie = `${LOCALE_COOKIE_NAME}=${encoded}; max-age=${COOKIE_MAX_AGE}; SameSite=Lax${secureAttr}`;
}
