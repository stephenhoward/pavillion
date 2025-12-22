import config from 'config';
import ServiceSettingEntity from "@/server/configuration/entity/settings";
import type { DefaultDateRange } from '@/common/model/calendar';

type Config = {
  registrationMode: 'open' | 'apply' | 'invite' | 'closed';
  siteTitle: string;
  eventInstanceMonths: number;
  defaultDateRange: DefaultDateRange;
};
class ServiceSettings {
  private static instance: ServiceSettings;
  private config: Config;

  private constructor() {
    this.config = {
      registrationMode: 'closed',
      siteTitle: config.get('domain'),
      eventInstanceMonths: 6,
      defaultDateRange: '2weeks',
    };
  }

  async init() {
    let settings = await ServiceSettingEntity.findAll();

    settings.forEach(entity => {
      if ( entity.parameter == 'registrationMode' ) {
        if ( ['open', 'apply', 'invite', 'closed'].includes(entity.value) ) {
          this.config[entity.parameter] = entity.value as 'open' | 'apply' | 'invite' | 'closed';
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
   * Updates a service setting
   * @param parameter: a valid service setting from the Config type
   * @param value: the new value for the setting
   * @returns Promise resolving to true if update was successful
   */
  async set(parameter: string, value: string|number): Promise<boolean> {
    if( ! (parameter in this.config) ) {
      console.error('Invalid parameter:', parameter);
      return false;
    }

    // Validate the mode
    if ( parameter == 'registrationMode' ) {
      if (!['open', 'apply', 'invite', 'closed'].includes(value as string)) {
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
        if (['open', 'apply', 'invite', 'closed'].includes(value as string)) {
          this.config.registrationMode = value as 'open' | 'apply' | 'invite' | 'closed';
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
      default:
        // For other parameters, just update the config
        break;
    }

    return true;
  }
}

export default ServiceSettings;
