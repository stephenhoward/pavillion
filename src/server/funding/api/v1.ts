import express, { Application } from 'express';
import { EventEmitter } from 'events';
import AdminRouteHandlers from '@/server/funding/api/v1/admin';
import FundingPlanRouteHandlers from '@/server/funding/api/v1/funding-plan';
import CalendarSubscriptionRoutes from '@/server/funding/api/v1/calendar-subscription';
import WebhookRouteHandlers from '@/server/funding/api/v1/webhooks';
import ProviderConnectionRoutes from '@/server/funding/api/v1/provider_connection';
import FundingInterface from '@/server/funding/interface';
import { ProviderConnectionService } from '@/server/funding/service/provider_connection';

/**
 * Funding API v1 aggregator
 *
 * Installs all funding API routes under /api/funding/v1
 */
export default class FundingApiV1 {
  static install(app: Application, internalAPI: FundingInterface, eventBus: EventEmitter): void {
    app.use(express.json());

    // Create provider connection service
    const providerConnectionService = new ProviderConnectionService(eventBus);

    // Install admin routes
    const adminRoutes = new AdminRouteHandlers(internalAPI, providerConnectionService);
    adminRoutes.installHandlers(app, '/api/funding/v1');

    // Install provider connection routes
    const providerRoutes = new ProviderConnectionRoutes(providerConnectionService);
    providerRoutes.installHandlers(app, '/api/funding/v1');

    // Install user subscription routes
    const subscriptionRoutes = new FundingPlanRouteHandlers(internalAPI);
    subscriptionRoutes.installHandlers(app, '/api/funding/v1');

    // Install calendar subscription routes
    const calendarSubscriptionRoutes = new CalendarSubscriptionRoutes(internalAPI);
    calendarSubscriptionRoutes.installHandlers(app, '/api/funding/v1');

    // Install webhook routes (separate prefix, no /v1)
    // Webhooks use raw body parsing, handled within the webhook routes
    const webhookRoutes = new WebhookRouteHandlers(internalAPI);
    webhookRoutes.installHandlers(app, '/api/funding');
  }
}
