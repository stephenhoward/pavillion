import { Request, Response, NextFunction } from 'express';
import { Account } from '@/common/model/account';
import { LOCALE_COOKIE_NAME } from '@/common/i18n/cookie';
import { parseAcceptLanguage } from '@/common/i18n/accept-language';
import { detectLocaleFromPath } from '@/common/i18n/locale-url';
import { isValidLanguageCode, DEFAULT_LANGUAGE_CODE, AVAILABLE_LANGUAGES, BETA_THRESHOLD } from '@/common/i18n/languages';
import ServiceSettings from '@/server/configuration/service/settings';
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
 * Resolves the instance default language from the settings service.
 *
 * Falls back gracefully if the settings service is unavailable.
 *
 * @param settingsService - The settings service instance
 * @returns Promise resolving to the instance default language code
 */
async function resolveInstanceDefault(settingsService?: ServiceSettings): Promise<string> {
  try {
    const settings = settingsService ?? await ServiceSettings.getInstance();
    const value = settings.get('defaultLanguage');

    if (value && isValidLanguageCode(String(value))) {
      return String(value);
    }
  }
  catch {
    // Settings service unavailable — fall through to hard-coded default
  }

  return DEFAULT_LANGUAGE_CODE;
}

/**
 * Returns the default set of enabled language codes.
 * Includes all languages meeting the BETA_THRESHOLD completeness threshold.
 */
function defaultEnabledLanguages(): string[] {
  return AVAILABLE_LANGUAGES
    .filter(lang => lang.completeness >= BETA_THRESHOLD)
    .map(lang => lang.code);
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
 *   5. Instance default language (from configuration service)
 *   6. Hard-coded 'en' fallback
 *
 * If the detected locale is not in the instance's enabledLanguages list,
 * the middleware falls back to the instance default.
 *
 * Individual detection steps (URL prefix, cookie, Accept-Language) can be
 * disabled via the localeDetectionMethods admin setting.
 *
 * @param configInterface - Optional ConfigurationInterface for accessing settings.
 *   When provided, settings are fetched via the interface (respects DDD boundaries).
 *   When omitted, falls back to direct ServiceSettings.getInstance() access.
 * @returns Express middleware function
 */
export function createLocaleMiddleware(configInterface?: ConfigurationInterface) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Resolve the settings service — via interface if provided, otherwise directly
    let settingsService: ServiceSettings | undefined;

    try {
      settingsService = configInterface
        ? await configInterface.getInstance()
        : await ServiceSettings.getInstance();
    }
    catch {
      // Settings unavailable — use defaults throughout
    }

    // Load admin language settings
    let forceLanguage: string | null = null;
    let detectionMethods = { urlPrefix: true, cookie: true, acceptLanguage: true };
    let enabledLanguages: string[] = defaultEnabledLanguages();

    try {
      if (settingsService) {
        forceLanguage = settingsService.getForceLanguage
          ? settingsService.getForceLanguage()
          : null;
        detectionMethods = settingsService.getLocaleDetectionMethods
          ? settingsService.getLocaleDetectionMethods()
          : detectionMethods;
        enabledLanguages = settingsService.getEnabledLanguages
          ? settingsService.getEnabledLanguages()
          : enabledLanguages;
      }
    }
    catch {
      // Settings unavailable — use defaults (all methods enabled, no force)
    }

    // 0. Admin forceLanguage override — always wins if set
    if (forceLanguage && isValidLanguageCode(forceLanguage)) {
      req.locale = forceLanguage;
      return next();
    }

    // 1. URL prefix (if enabled)
    if (detectionMethods.urlPrefix) {
      const urlLocale = detectLocaleFromPath(req.path);

      if (urlLocale && isValidLanguageCode(urlLocale) && enabledLanguages.includes(urlLocale)) {
        req.locale = urlLocale;
        return next();
      }
    }

    // 2. Account language (populated by passport after JWT auth)
    const user = req.user as Account | undefined;

    if (user?.language && isValidLanguageCode(user.language) && enabledLanguages.includes(user.language)) {
      req.locale = user.language;
      return next();
    }

    // 3. Locale cookie (if enabled)
    if (detectionMethods.cookie) {
      const cookieLocale = readCookieFromRequest(req);

      if (cookieLocale && isValidLanguageCode(cookieLocale) && enabledLanguages.includes(cookieLocale)) {
        req.locale = cookieLocale;
        return next();
      }
    }

    // 4. Accept-Language header (if enabled)
    if (detectionMethods.acceptLanguage) {
      const acceptLocale = resolveFromAcceptLanguage(req);

      if (acceptLocale && enabledLanguages.includes(acceptLocale)) {
        req.locale = acceptLocale;
        return next();
      }
    }

    // 5. Instance default language
    const instanceDefault = await resolveInstanceDefault(settingsService);

    req.locale = instanceDefault;
    next();
  };
}

/**
 * Default locale middleware instance for backward compatibility.
 *
 * Uses ServiceSettings directly (no ConfigurationInterface injection).
 * Prefer createLocaleMiddleware(configInterface) in production server setup
 * to maintain domain-driven design boundaries.
 */
export const localeMiddleware = createLocaleMiddleware();
