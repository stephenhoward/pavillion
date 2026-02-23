import { Request, Response, NextFunction } from 'express';
import { Account } from '@/common/model/account';
import { LOCALE_COOKIE_NAME } from '@/common/i18n/cookie';
import { parseAcceptLanguage } from '@/common/i18n/accept-language';
import { stripLocalePrefix } from '@/common/i18n/locale-url';
import { isValidLanguageCode, DEFAULT_LANGUAGE_CODE, getDefaultEnabledLanguageCodes } from '@/common/i18n/languages';
import type ConfigurationInterface from '@/server/configuration/interface';

declare module 'express-serve-static-core' {
  interface Request {
    locale: string;
  }
}

/**
 * Reads the pavilion_locale cookie value from the request Cookie header.
 *
 * Express does not parse cookies by default, so we read the raw Cookie header
 * and extract the value for LOCALE_COOKIE_NAME manually.
 *
 * @param req - Express request object
 * @returns The stored locale string (e.g. 'en', 'es'), or null if not set
 */
function readCookieFromRequest(req: Request): string | null {
  const cookieHeader = req.headers['cookie'];

  if (!cookieHeader) {
    return null;
  }

  for (const cookie of cookieHeader.split(';')) {
    const [name, value] = cookie.split('=');

    if (name.trim() === LOCALE_COOKIE_NAME && value) {
      try {
        return decodeURIComponent(value.trim());
      }
      catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Resolves the best locale from the Accept-Language header.
 *
 * Iterates the parsed preferences (ordered by quality) and returns the first
 * supported language code, or null if none match.
 *
 * @param req - Express request object
 * @returns A valid language code or null
 */
function resolveFromAcceptLanguage(req: Request): string | null {
  const header = req.headers['accept-language'] as string | undefined;

  if (!header) {
    return null;
  }

  const preferences = parseAcceptLanguage(header);

  for (const pref of preferences) {
    if (isValidLanguageCode(pref.language)) {
      return pref.language;
    }
  }

  return null;
}

/**
 * Creates an Express middleware that resolves req.locale for every request.
 *
 * Detection chain (first match wins):
 *   0. forceLanguage admin override (if set, always use it)
 *   1. URL prefix (e.g. /es/@calendar → 'es')
 *   2. Account language (req.user.language when authenticated)
 *   3. pavilion_locale cookie
 *   4. Accept-Language header (highest quality supported language)
 *   5. Instance default language (from configuration interface)
 *   6. Hard-coded 'en' fallback
 *
 * If the detected locale is not in the instance's enabledLanguages list,
 * the middleware falls back to the instance default.
 *
 * @param configInterface - ConfigurationInterface for reading language settings.
 *   When provided, settings are fetched via the interface (respects DDD boundaries).
 *   When omitted, falls back to hardcoded defaults for all language settings.
 * @returns Express middleware function
 */
export function createLocaleMiddleware(configInterface?: ConfigurationInterface) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Load admin language settings via ConfigurationInterface
    let forceLanguage: string | null = null;
    let enabledLanguages: string[] = getDefaultEnabledLanguageCodes();
    let instanceDefault: string = DEFAULT_LANGUAGE_CODE;

    if (configInterface) {
      try {
        [forceLanguage, enabledLanguages, instanceDefault] = await Promise.all([
          configInterface.getForceLanguage(),
          configInterface.getEnabledLanguages(),
          configInterface.getDefaultLanguage(),
        ]);
      }
      catch {
        // Settings unavailable — use defaults throughout
      }
    }

    // 0. Admin forceLanguage override — always wins if set
    if (forceLanguage && isValidLanguageCode(forceLanguage)) {
      req.locale = forceLanguage;
      return next();
    }

    // 1. URL prefix
    const urlLocale = stripLocalePrefix(req.path).locale;

    if (urlLocale && isValidLanguageCode(urlLocale) && enabledLanguages.includes(urlLocale)) {
      req.locale = urlLocale;
      return next();
    }

    // 2. Account language (populated by passport after JWT auth)
    const user = req.user as Account | undefined;

    if (user?.language && isValidLanguageCode(user.language) && enabledLanguages.includes(user.language)) {
      req.locale = user.language;
      return next();
    }

    // 3. Locale cookie
    const cookieLocale = readCookieFromRequest(req);

    if (cookieLocale && isValidLanguageCode(cookieLocale) && enabledLanguages.includes(cookieLocale)) {
      req.locale = cookieLocale;
      return next();
    }

    // 4. Accept-Language header
    const acceptLocale = resolveFromAcceptLanguage(req);

    if (acceptLocale && enabledLanguages.includes(acceptLocale)) {
      req.locale = acceptLocale;
      return next();
    }

    // 5. Instance default language
    req.locale = instanceDefault;
    next();
  };
}
