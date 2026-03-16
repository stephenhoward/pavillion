import express, { Application } from 'express';
import { EventEmitter } from 'events';
import AdminRoutes from '@/server/funding/api/v1/admin';
import FundingPlanRoutes from '@/server/funding/api/v1/funding-plan';
import CalendarFundingPlanRoutes from '@/server/funding/api/v1/calendar-funding-plan';
import CheckoutSessionRoutes from '@/server/funding/api/v1/checkout-session';
import WebhookRoutes from '@/server/funding/api/v1/webhooks';
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
    const adminRoutes = new AdminRoutes(internalAPI, providerConnectionService);
    adminRoutes.installHandlers(app, '/api/funding/v1');

    // Install provider connection routes
    const providerRoutes = new ProviderConnectionRoutes(providerConnectionService);
    providerRoutes.installHandlers(app, '/api/funding/v1');

    // Install user funding plan routes
    const fundingPlanRoutes = new FundingPlanRoutes(internalAPI);
    fundingPlanRoutes.installHandlers(app, '/api/funding/v1');

    // Install calendar funding plan routes
    const calendarFundingPlanRoutes = new CalendarFundingPlanRoutes(internalAPI);
    calendarFundingPlanRoutes.installHandlers(app, '/api/funding/v1');

    // Install checkout session routes
    const checkoutSessionRoutes = new CheckoutSessionRoutes(internalAPI);
    checkoutSessionRoutes.installHandlers(app, '/api/funding/v1');

    // Install webhook routes (separate prefix, no /v1)
    // Webhooks use raw body parsing, handled within the webhook routes
    const webhookRoutes = new WebhookRoutes(internalAPI);
    webhookRoutes.installHandlers(app, '/api/funding');
  }
}
