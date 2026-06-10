import express, { Application } from 'express';
import SetupRouteHandlers from '@/server/setup/api/v1/setup';
import SetupInterface from '@/server/setup/interface';

/**
 * Setup API v1 entry point.
 */
export default class SetupApiV1 {
  static install(app: Application, setupInterface: SetupInterface): void {
    // Scoped, not global: a bare app.use(express.json()) would also consume
    // raw-body routes like the Stripe webhook (/api/funding/webhooks) (pv-ufag).
    app.use('/api/v1', express.json());

    const setupRouteHandlers = new SetupRouteHandlers(setupInterface);
    setupRouteHandlers.installHandlers(app, '/api/v1');
  }
}
