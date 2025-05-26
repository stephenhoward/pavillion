import SettingsService from '@/server/configuration/service/settings';
import { EventEmitter } from 'events';
/**
 * Implementation of the Configuration Internal API.
 * Aggregates functionality from ServiceSettings.
 */
export default class ConfigurationInterface {

  constructor(eventBus: EventEmitter ) {}

  async getSetting(key: string): Promise<string | undefined> {
    return ( await SettingsService.getInstance()).get(key);
  }

  async setSetting(parameter: string, value: string): Promise<boolean> {
    return ( await SettingsService.getInstance()).set(parameter, value);
  }

  async getAllSettings(): Promise<Record<string, string>> {
    const settings = await SettingsService.getInstance();
    // Return commonly accessed settings
    return {
      registrationMode: settings.get('registrationMode') || 'closed',
      siteTitle: settings.get('siteTitle') || '',
    };
  }

  async getInstance(): Promise<SettingsService> {
    return SettingsService.getInstance();
  }
}
