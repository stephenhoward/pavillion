import express, { Application } from 'express';
import AccountRoutes from '@/server/accounts/api/v1/accounts';
import AccountInvitationRoutes from '@/server/accounts/api/v1/invitations';
import AccountApplicationRoutes from '@/server/accounts/api/v1/applications';
import AdminAccountRoutes from '@/server/accounts/api/v1/admin';
import AccountsInterface from '@/server/accounts/interface';

export default class AccountApiV1 {

  static install(app: Application, internalAPI: AccountsInterface) {
    app.use(express.json());

    const accountRouteHandlers = new AccountRoutes(internalAPI);
    accountRouteHandlers.installHandlers(app, '/api/accounts/v1');

    const accountApplicationRouteHandlers = new AccountApplicationRoutes(internalAPI);
    accountApplicationRouteHandlers.installHandlers(app, '/api/accounts/v1');

    const accountInvitationRoutes = new AccountInvitationRoutes(internalAPI);
    accountInvitationRoutes.installHandlers(app, '/api/accounts/v1');

    const adminAccountRoutes = new AdminAccountRoutes(internalAPI);
    adminAccountRoutes.installHandlers(app, '/api/v1');
  }
}
