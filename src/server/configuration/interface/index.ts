import SettingsService from '@/server/configuration/service/settings';
import ServiceSettingEntity from '@/server/configuration/entity/settings';

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

  async getInstance(): Promise<SettingsService> {
    return SettingsService.getInstance();
  }
}
