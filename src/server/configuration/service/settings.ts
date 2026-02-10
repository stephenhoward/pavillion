import config from 'config';
import ServiceSettingEntity from "@/server/configuration/entity/settings";
import type { DefaultDateRange } from '@/common/model/calendar';
import { isValidLanguageCode, DEFAULT_LANGUAGE_CODE } from '@/common/i18n/languages';

type Config = {
  registrationMode: 'open' | 'apply' | 'invitation' | 'closed';
  siteTitle: string;
  eventInstanceMonths: number;
  defaultDateRange: DefaultDateRange;
  defaultLanguage: string;
};
class ServiceSettings {
  private static instance: ServiceSettings;
  private config: Config;

  private constructor() {
    this.config = {
      registrationMode: 'invitation',
      siteTitle: config.get('domain'),
      eventInstanceMonths: 6,
      defaultDateRange: '2weeks',
      defaultLanguage: DEFAULT_LANGUAGE_CODE,
    };
  }

  async init() {
    let settings = await ServiceSettingEntity.findAll();

    settings.forEach(entity => {
      if ( entity.parameter == 'registrationMode' ) {
        if ( ['open', 'apply', 'invitation', 'closed'].includes(entity.value) ) {
          this.config[entity.parameter] = entity.value as 'open' | 'apply' | 'invitation' | 'closed';
        }
      }
      if( entity.parameter == 'siteTitle' ) {
        this.config.siteTitle = entity.value;
      }
      if ( entity.parameter == 'defaultDateRange' ) {
        if ( ['1week', '2weeks', '1month'].includes(entity.value) ) {
          this.config.defaultDateRange = entity.value as DefaultDateRange;
        }
      }
      if ( entity.parameter == 'defaultLanguage' ) {
        if ( isValidLanguageCode(entity.value) ) {
          this.config.defaultLanguage = entity.value;
        }
      }
    });
  }

  static async getInstance(): Promise<ServiceSettings> {
    if (!ServiceSettings.instance) {
      ServiceSettings.instance = new ServiceSettings();
      await ServiceSettings.instance.init();
    }
    return ServiceSettings.instance;
  }

  get(key: string): string | number | undefined {
    if ( key in this.config) {
      return this.config[key as keyof Config];
    }
  }

  /**
   * Updates a service setting.
   *
   * For known Config keys, validates the value and updates the in-memory cache.
   * For extension keys (e.g. moderation.*), persists directly to the database
   * without in-memory caching.
   *
   * @param parameter - Setting key
   * @param value - The new value for the setting
   * @returns Promise resolving to true if update was successful
   */
  async set(parameter: string, value: string|number): Promise<boolean> {
    // For known Config keys, validate and update in-memory cache
    if (parameter in this.config) {
      return this.setKnownParameter(parameter, value);
    }

    // For extension keys (e.g. moderation.*), persist directly to database
    return this.setExtensionParameter(parameter, value);
  }

  /**
   * Handles setting of known Config-typed parameters with validation.
   */
  private async setKnownParameter(parameter: string, value: string|number): Promise<boolean> {
    // Validate the mode
    if ( parameter == 'registrationMode' ) {
      if (!['open', 'apply', 'invitation', 'closed'].includes(value as string)) {
        console.error('Invalid registration mode:', value);
        return false;
      }
    }

    // Validate the defaultDateRange
    if ( parameter == 'defaultDateRange' ) {
      if (!['1week', '2weeks', '1month'].includes(value as string)) {
        console.error('Invalid default date range:', value);
        return false;
      }
    }

    // Validate the defaultLanguage
    if ( parameter == 'defaultLanguage' ) {
      if (!isValidLanguageCode(value as string)) {
        console.error('Invalid default language:', value);
        return false;
      }
    }

    // Update or create the setting in the database
    const [entity, created] = await ServiceSettingEntity.findOrCreate({
      where: { parameter },
      defaults: { parameter, value },
    });

    if (!created) {
      entity.value = value as string;
      await entity.save();
    }

    switch (parameter) {
      case 'registrationMode':
        if (['open', 'apply', 'invitation', 'closed'].includes(value as string)) {
          this.config.registrationMode = value as 'open' | 'apply' | 'invitation' | 'closed';
        }
        else {
          console.error('Invalid registration mode:', value);
          return false;
        }
        break;
      case 'siteTitle':
        this.config.siteTitle = value as string;
        break;
      case 'eventInstanceMonths':
        if (typeof value === 'number' && value > 0) {
          this.config.eventInstanceMonths = value as number;
        }
        else {
          console.error('Invalid event instance months:', value);
          return false;
        }
        break;
      case 'defaultDateRange':
        if (['1week', '2weeks', '1month'].includes(value as string)) {
          this.config.defaultDateRange = value as DefaultDateRange;
        }
        else {
          console.error('Invalid default date range:', value);
          return false;
        }
        break;
      case 'defaultLanguage':
        if (isValidLanguageCode(value as string)) {
          this.config.defaultLanguage = value as string;
        }
        else {
          console.error('Invalid default language:', value);
          return false;
        }
        break;
      default:
        break;
    }

    return true;
  }

  /**
   * Persists an extension parameter directly to the database.
   * Extension parameters (e.g. moderation.*) are not tracked in the
   * in-memory Config but are stored in the service_config table.
   *
   * @param parameter - Extension setting key
   * @param value - The value to store
   * @returns Promise resolving to true if persisted successfully
   */
  private async setExtensionParameter(parameter: string, value: string|number): Promise<boolean> {
    const [entity, created] = await ServiceSettingEntity.findOrCreate({
      where: { parameter },
      defaults: { parameter, value: String(value) },
    });

    if (!created) {
      entity.value = String(value);
      await entity.save();
    }

    return true;
  }
}

export default ServiceSettings;
