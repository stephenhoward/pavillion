import { ObjectBindingOrAssignmentPattern } from "typescript";
import ServiceSettingEntity from "@/server/common/entity/service";

interface Config {
    [registrationMode: string] : 'open' | 'apply' | 'invite' | 'closed';
}
class ServiceSettings {
    private static instance: ServiceSettings;
    private config: Config;

    private constructor() {
        this.config = {};
    }

    async init() {
        let settings = await ServiceSettingEntity.findAll();

        settings.forEach(entity => {
            if ( entity.parameter == 'registrationMode' ) {
                if ( ['open', 'apply', 'invite', 'closed'].includes(entity.value) ) {
                    this.config[entity.parameter] = entity.value as 'open' | 'apply' | 'invite' | 'closed';
                }
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
