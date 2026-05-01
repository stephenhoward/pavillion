import express, { Application } from 'express';
import ConfigRoutes from '@/server/configuration/api/v1/site';
import ConfigurationInterface from '@/server/configuration/interface';

export default class ConfigApiV1 {
  static install(app: Application, internalAPI: ConfigurationInterface): void {
    // Cap request body size at the configuration v1 mount point so payloads
    // are rejected at the edge before reaching validation. Configuration
    // settings are small (string/array values), 512kb is generous headroom.
    app.use('/api/config/v1', express.json({ limit: '512kb' }));

    const configRouteHandlers = new ConfigRoutes(internalAPI);
    configRouteHandlers.installHandlers(app, '/api/config/v1');
  }
}
