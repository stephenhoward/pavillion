import config from 'config';
import express from 'express';
import initPavillionServer from '@/server/server';

/**
 * Entrypoint for the Pavillion server application.
 * If an application is provided, it configures that application, otherwise it creates a new one.
 *
 * @param {express.Application} [providedApp] - Optional Express application instance to configure
 * @returns {Promise<express.Application>} The configured Express application (resolves after initialization completes)
 */
const main = async (providedApp?: express.Application): Promise<express.Application> => {
  const app: express.Application = providedApp || express();

  await initPavillionServer(app, config.get('host.port'));

  return app;
};

// Fire and forget - don't await in production entrypoint
main();

export default main;
