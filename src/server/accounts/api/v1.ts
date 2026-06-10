import express, { Application } from 'express';
import AccountRoutes from '@/server/accounts/api/v1/accounts';
import AccountInvitationRoutes from '@/server/accounts/api/v1/invitations';
import AccountApplicationRoutes from '@/server/accounts/api/v1/applications';
import AdminAccountRoutes from '@/server/accounts/api/v1/admin';
import AccountsInterface from '@/server/accounts/interface';

export default class AccountApiV1 {

  static install(app: Application, internalAPI: AccountsInterface) {
    // Scope JSON parsing to this domain's routes. A global app.use(express.json())
    // is a cross-cutting side effect that also consumes the body of raw-body routes
    // (e.g. the Stripe webhook at /api/funding/webhooks), breaking signature
    // verification (pv-ufag). Keep parsers scoped to the prefixes they serve.
    app.use('/api/v1', express.json());

    const accountRouteHandlers = new AccountRoutes(internalAPI);
    accountRouteHandlers.installHandlers(app, '/api/v1');

    const accountApplicationRouteHandlers = new AccountApplicationRoutes(internalAPI);
    accountApplicationRouteHandlers.installHandlers(app, '/api/v1');

    const accountInvitationRoutes = new AccountInvitationRoutes(internalAPI);
    accountInvitationRoutes.installHandlers(app, '/api/v1');

    const adminAccountRoutes = new AdminAccountRoutes(internalAPI);
    adminAccountRoutes.installHandlers(app, '/api/v1');
  }
}
