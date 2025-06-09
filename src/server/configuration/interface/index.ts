import SettingsService from '@/server/configuration/service/settings';
/**
 * Implementation of the Configuration Internal API.
 * Aggregates functionality from ServiceSettings.
 */
export default class ConfigurationInterface {

  constructor() {}

  async getSetting(key: string): Promise<string | undefined> {
    const value = (await SettingsService.getInstance()).get(key);
    return value?.toString();
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
