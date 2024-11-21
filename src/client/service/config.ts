import axios from 'axios';

type Settings = {
    registrationMode: string
};

export default class Config {
    private static _settings: Settings;

    static async init() {

        if( Config._settings ) {
            return new Config();
        }

        await Config._load_settings();
        return new Config();
    }

    async reload() {

        await Config._load_settings();
    }

    static async _load_settings() {
        let settings = await axios.get( '/api/server/v1/site');
        Config._settings = settings.data;
    }
    
    settings() {
        return Config._settings;
    }
}
