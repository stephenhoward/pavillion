import axios from 'axios';
import type { DefaultDateRange } from '@/common/model/calendar';

type Settings = {
  registrationMode: string;
  defaultDateRange: DefaultDateRange;
};

/**
 * Configuration service to manage server settings.
 * Provides methods to access server settings.
 */
export default class Config {
  private static _settings: Settings;

  /**
   * Initializes the configuration service.
   * Loads the settings from the server and caches them
   *
   * @returns {Promise<Config>} A promise resolving to a new Config instance
   */
  static async init(): Promise<Config> {

    if( Config._settings ) {
      return new Config();
    }

    await Config._load_settings();
    return new Config();
  }

  /**
   * Reloads settings from the server.
   *
   * @returns {Promise<void>}
   */
  async reload(): Promise<void> {

    await Config._load_settings();
  }

  /**
   * Private method to load settings from the server API.
   *
   * @returns {Promise<void>}
   * @private
   */
  static async _load_settings(): Promise<void> {
    let settings = await axios.get( '/api/config/v1/site');
    Config._settings = settings.data;
  }

  /**
   * Returns the current server settings.
   *
   * @returns {Settings} The current application settings
   */
  settings(): Settings {
    return Config._settings;
  }

  /**
   * Updates the registration mode setting on the server
   *
   * @param {string} mode - The new registration mode ('open', 'apply', 'invite', or 'closed')
   * @returns {Promise<boolean>} A promise that resolves to true if the update was successful
   */
  async updateSettings(settings: Record<string,string>): Promise<boolean> {
    try {
      const response = await axios.post('/api/config/v1/site', settings);
      if (response.status === 200) {
        // Reload settings after successful update
        await Config._load_settings();
        return true;
      }
      return false;
    }
    catch (error) {
      console.error('Failed to update service settings:', error);
      return false;
    }
  }
}
