import express, { Application } from 'express';
import ConfigRoutes from '@/server/configuration/api/v1/site';
import SettingsInterface from '@/server/configuration/interface';

export default class ConfigApiV1 {
  static install(app: Application, internalAPI: SettingsInterface): void {
    app.use(express.json());

    const configRouteHandlers = new ConfigRoutes(internalAPI);
    configRouteHandlers.installHandlers(app, '/api/config/v1');
  }
}
