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
    Object.freeze(this.config);
  }

  static async getInstance(): Promise<ServiceSettings> {
    if (!ServiceSettings.instance) {
      ServiceSettings.instance = new ServiceSettings();
      await ServiceSettings.instance.init();
    }
    return ServiceSettings.instance;
  }

  get(key: string): string | undefined {
    return this.config[key];
  }
}

export default ServiceSettings;
