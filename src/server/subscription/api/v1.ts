import express, { Application } from 'express';
import { EventEmitter } from 'events';
import AdminRouteHandlers from '@/server/subscription/api/v1/admin';
import SubscriptionRouteHandlers from '@/server/subscription/api/v1/subscription';
import WebhookRouteHandlers from '@/server/subscription/api/v1/webhooks';
import ProviderConnectionRoutes from '@/server/subscription/api/v1/provider_connection';
import SubscriptionInterface from '@/server/subscription/interface';
import { ProviderConnectionService } from '@/server/subscription/service/provider_connection';

/**
 * Subscription API v1 aggregator
 *
 * Installs all subscription API routes under /api/subscription/v1
 */
export default class SubscriptionApiV1 {
  static install(app: Application, internalAPI: SubscriptionInterface, eventBus: EventEmitter): void {
    app.use(express.json());

    // Create provider connection service
    const providerConnectionService = new ProviderConnectionService(eventBus);

    // Install admin routes
    const adminRoutes = new AdminRouteHandlers(internalAPI, providerConnectionService);
    adminRoutes.installHandlers(app, '/api/subscription/v1');

    // Install provider connection routes
    const providerRoutes = new ProviderConnectionRoutes(providerConnectionService);
    providerRoutes.installHandlers(app, '/api/subscription/v1');

    // Install user subscription routes
    const subscriptionRoutes = new SubscriptionRouteHandlers(internalAPI);
    subscriptionRoutes.installHandlers(app, '/api/subscription/v1');

    // Install webhook routes (separate prefix, no /v1)
    // Webhooks use raw body parsing, handled within the webhook routes
    const webhookRoutes = new WebhookRouteHandlers(internalAPI);
    webhookRoutes.installHandlers(app, '/api/subscription');
  }
}
