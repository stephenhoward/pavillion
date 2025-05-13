import config from 'config';
import ServiceSettingEntity from "@/server/configuration/entity/settings";

type Config = {
  registrationMode: 'open' | 'apply' | 'invite' | 'closed';
  siteTitle: string;
};
class ServiceSettings {
  private static instance: ServiceSettings;
  private config: Config;

  private constructor() {
    this.config = {
      registrationMode: 'closed',
      siteTitle: config.get('domain'),
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
    });
  }

  static async getInstance(): Promise<ServiceSettings> {
    if (!ServiceSettings.instance) {
      ServiceSettings.instance = new ServiceSettings();
      await ServiceSettings.instance.init();
    }
    return ServiceSettings.instance;
  }

  get(key: string): string | undefined {
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
  async set(parameter: string, value: string): Promise<boolean> {
    if( ! (parameter in this.config) ) {
      console.error('Invalid parameter:', parameter);
      return false;
    }

    // Validate the mode
    if ( parameter == 'registrationMode' ) {
      if (!['open', 'apply', 'invite', 'closed'].includes(value)) {
        console.error('Invalid registration mode:', value);
        return false;
      }
    }

    // Update or create the setting in the database
    const [entity, created] = await ServiceSettingEntity.findOrCreate({
      where: { parameter },
      defaults: { parameter, value },
    });

    if (!created) {
      entity.value = value;
      await entity.save();
    }

    this.config[parameter as keyof Config] =  value;// as 'open' | 'apply' | 'invite' | 'closed';

    return true;
  }
}

export default ServiceSettings;
