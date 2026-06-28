import express, { Application } from 'express';
import AdminRoutes from '@/server/funding/api/v1/admin';
import FundingPlanRoutes from '@/server/funding/api/v1/funding-plan';
import CalendarFundingPlanRoutes from '@/server/funding/api/v1/calendar-funding-plan';
import CheckoutSessionRoutes from '@/server/funding/api/v1/checkout-session';
import WebhookRoutes from '@/server/funding/api/v1/webhooks';
import ProviderConnectionRoutes from '@/server/funding/api/v1/provider_connection';
import FundingInterface from '@/server/funding/interface';

/**
 * Funding API v1 aggregator
 *
 * Installs all funding API routes under /api/funding/v1
 */
export default class FundingApiV1 {
  static install(app: Application, internalAPI: FundingInterface): void {
    // Scope JSON body parsing to the /v1 API only. The Stripe webhook route
    // (mounted below at /api/funding/webhooks) needs the raw request body for
    // signature verification — a global app.use(express.json()) would consume
    // and parse the body first, leaving the webhook handler with "[object
    // Object]" and breaking every signature check (pv-ufag).
    app.use('/api/funding/v1', express.json());

    // Install admin routes
    const adminRoutes = new AdminRoutes(internalAPI);
    adminRoutes.installHandlers(app, '/api/funding/v1');

    // Install provider connection routes
    const providerRoutes = new ProviderConnectionRoutes(internalAPI);
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
