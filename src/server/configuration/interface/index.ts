import SettingsService from '@/server/configuration/service/settings';
import ServiceSettingEntity from '@/server/configuration/entity/settings';
import { DEFAULT_LANGUAGE_CODE, AVAILABLE_LANGUAGES, BETA_THRESHOLD } from '@/common/i18n/languages';

type LocaleDetectionMethods = {
  urlPrefix: boolean;
  cookie: boolean;
  acceptLanguage: boolean;
};

/**
 * Implementation of the Configuration Internal API.
 * Aggregates functionality from ServiceSettings.
 */
export default class ConfigurationInterface {

  constructor() {}

  /**
   * Retrieves a setting value by key.
   *
   * First checks the in-memory typed config via SettingsService.
   * If not found there (e.g. for extension keys like moderation.*),
   * falls back to a direct database lookup.
   *
   * @param key - Setting key to look up
   * @returns The setting value as a string, or undefined if not found
   */
  async getSetting(key: string): Promise<string | undefined> {
    const value = (await SettingsService.getInstance()).get(key);
    if (value !== undefined) {
      return value.toString();
    }

    // Fall back to direct database lookup for extension keys
    // not tracked in the in-memory Config type (e.g. moderation.*)
    const entity = await ServiceSettingEntity.findByPk(key);
    return entity?.value ?? undefined;
  }

  async setSetting(parameter: string, value: string): Promise<boolean> {
    return (await SettingsService.getInstance()).set(parameter, value);
  }

  async getAllSettings(): Promise<Record<string, string>> {
    const settings = await SettingsService.getInstance();
    // Return commonly accessed settings
    return {
      registrationMode: settings.get('registrationMode')?.toString() || 'closed',
      siteTitle: settings.get('siteTitle')?.toString() || '',
    };
  }

  /**
   * Returns the instance default language code.
   *
   * @returns Promise resolving to the default language code
   */
  async getDefaultLanguage(): Promise<string> {
    try {
      const settings = await SettingsService.getInstance();
      const value = settings.get('defaultLanguage');
      if (value && typeof value === 'string') {
        return value;
      }
    }
    catch {
      // Settings unavailable — fall through
    }
    return DEFAULT_LANGUAGE_CODE;
  }

  /**
   * Returns the list of enabled language codes for this instance.
   *
   * @returns Promise resolving to array of enabled language codes
   */
  async getEnabledLanguages(): Promise<string[]> {
    try {
      const settings = await SettingsService.getInstance();
      return settings.getEnabledLanguages();
    }
    catch {
      return AVAILABLE_LANGUAGES
        .filter(lang => lang.completeness >= BETA_THRESHOLD)
        .map(lang => lang.code);
    }
  }

  /**
   * Returns the forced language override for all users, or null if not set.
   *
   * @returns Promise resolving to a language code or null
   */
  async getForceLanguage(): Promise<string | null> {
    try {
      const settings = await SettingsService.getInstance();
      return settings.getForceLanguage();
    }
    catch {
      return null;
    }
  }

  /**
   * Returns the locale detection methods configuration.
   *
   * @returns Promise resolving to detection method flags
   */
  async getLocaleDetectionMethods(): Promise<LocaleDetectionMethods> {
    try {
      const settings = await SettingsService.getInstance();
      return settings.getLocaleDetectionMethods();
    }
    catch {
      return { urlPrefix: true, cookie: true, acceptLanguage: true };
    }
  }
}
