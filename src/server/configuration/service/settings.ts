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
   * Updates the registration mode setting
   * @param mode The new registration mode ('open', 'apply', 'invite', or 'closed')
   * @returns Promise resolving to true if update was successful
   */
  async setRegistrationMode(mode: 'open' | 'apply' | 'invite' | 'closed'): Promise<boolean> {
    // Validate the mode
    if (!['open', 'apply', 'invite', 'closed'].includes(mode)) {
      return false;
    }

    // Update or create the setting in the database
    const [entity, created] = await ServiceSettingEntity.findOrCreate({
      where: { parameter: 'registrationMode' },
      defaults: { parameter: 'registrationMode', value: mode },
    });

    if (!created) {
      entity.value = mode;
      await entity.save();
    }

    this.config.registrationMode = mode;

    return true;
  }
}

export default ServiceSettings;
