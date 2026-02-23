import type { InitOptions, FallbackLngObjList } from 'i18next';
import { AVAILABLE_LANGUAGES, DEFAULT_LANGUAGE_CODE } from '@/common/i18n/languages';

/**
 * The three server-side locale detection methods supported by Pavillion.
 * Each flag enables or disables the corresponding detection strategy.
 */
export type LocaleDetectionMethods = {
  urlPrefix: boolean;
  cookie: boolean;
  acceptLanguage: boolean;
};

/**
 * App-specific options that can be merged into the base i18next configuration.
 *
 * The `backend` and `detection` fields correspond to i18next plugin configuration.
 * Any additional i18next InitOptions keys can be passed through the index signature.
 */
export interface I18nConfigOptions {
  backend?: object;
  detection?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Builds the per-language fallbackLng map expected by i18next from the
 * AVAILABLE_LANGUAGES definitions.
 *
 * i18next fallbackLng object format:
 *   { pt: ['es', 'en'], es: ['en'], default: ['en'] }
 *
 * English has an empty fallbackChain, so it is omitted from the map;
 * i18next will not need a fallback for the ultimate fallback language.
 * A `default` key is always added pointing to [DEFAULT_LANGUAGE_CODE].
 *
 * @returns FallbackLngObjList suitable for i18next InitOptions.fallbackLng
 */
export function buildFallbackLng(): FallbackLngObjList {
  const result: FallbackLngObjList = {};

  for (const lang of AVAILABLE_LANGUAGES) {
    if (lang.fallbackChain.length > 0) {
      result[lang.code] = lang.fallbackChain;
    }
  }

  result['default'] = [DEFAULT_LANGUAGE_CODE];

  return result;
}

/**
 * Creates a base i18next InitOptions configuration with enforced settings.
 *
 * Enforced settings (always applied, not overridable by callers):
 * - `returnEmptyString: false`   — empty strings fall through to the fallback chain
 * - `nonExplicitSupportedLngs: true` — `es-MX` automatically falls back to `es`
 * - `load: 'languageOnly'`       — loads base language files only (not region variants)
 * - `fallbackLng`                — per-language chains from AVAILABLE_LANGUAGES
 * - `debug`                      — enabled in development mode for missing-key warnings
 *
 * App-specific settings (passed via `options` and merged in):
 * - `backend`   — backend plugin configuration (e.g. file path for server, HTTP for browser)
 * - `detection` — language detection plugin configuration
 * - Any other valid InitOptions fields
 *
 * @param options - App-specific overrides and plugin configurations
 * @returns Complete i18next InitOptions ready to pass to i18next.init()
 */
export function createI18nConfig(options?: I18nConfigOptions): InitOptions {
  const { backend, detection, ...rest } = options ?? {};

  const config: InitOptions = {
    // Spread app-specific overrides first so enforced settings below win
    ...rest,

    // Enforced settings — these must not be overridden by callers
    debug: process.env.NODE_ENV === 'development',
    returnEmptyString: false,
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    fallbackLng: buildFallbackLng(),
  };

  if (backend !== undefined) {
    config.backend = backend;
  }

  if (detection !== undefined) {
    config.detection = detection;
  }

  return config;
}
