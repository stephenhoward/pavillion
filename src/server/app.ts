import config from 'config';
import express from 'express';
import { isWorkerMode } from '@/server/common/helper/app-mode';
import initPavillionServer from '@/server/server';

/**
 * Entrypoint for the Pavillion server application.
 * Supports dual-mode operation:
 * - Web mode (default): Starts Express HTTP server
 * - Worker mode (--worker flag): Starts background job processor
 *
 * @param {express.Application} [providedApp] - Optional Express application instance to configure
 * @returns {Promise<express.Application>} The configured Express application (resolves after initialization completes)
 */
const main = async (providedApp?: express.Application): Promise<express.Application> => {
  // Check if running in worker mode
  if (isWorkerMode()) {
    console.log('[Pavillion] Starting in worker mode');
    console.log('[Pavillion] Job processing: enabled');

    // Import and start worker instead of web server
    await import('@/server/worker');

    // Return a dummy app for consistency (worker doesn't use Express)
    return express();
  }

  // Web mode: start HTTP server
  console.log('[Pavillion] Starting in web mode');
  console.log('[Pavillion] Job processing: disabled (use worker container)');

  const app: express.Application = providedApp || express();
  await initPavillionServer(app, config.get('host.port'));

  return app;
};

// Fire and forget - don't await in production entrypoint
main();

export default main;
