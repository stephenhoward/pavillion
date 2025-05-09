import express from 'express';
import initPavillionServer from '@/server/server';

/**
 * Entrypoint for the Pavillion server application.
 * If an application is provided, it configures that application, otherwise it creates a new one.
 *
 * @param {express.Application} [providedApp] - Optional Express application instance to configure
 * @returns {express.Application} The configured Express application
 */
const main = (providedApp?: express.Application): express.Application => {
  const app: express.Application = providedApp || express();

  initPavillionServer(app);

  return app;
};

main();

export default main;
