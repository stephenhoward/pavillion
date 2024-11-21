import express, { Application, Router } from 'express';
import AccountRoutes from './v1/accounts';
import AccountInvitationRoutes from './v1/invitations';
import AccountApplicationRoutes from './v1/applications';
import SiteRoutes from './v1/site';

const apiV1 = (app: Application) => {

    const router = Router();
    app.use(express.json());
    app.use('/api/accounts/v1', AccountRoutes);
    app.use('/api/accounts/v1', AccountInvitationRoutes);
    app.use('/api/accounts/v1', AccountApplicationRoutes );
    app.use('/api/server/v1', SiteRoutes );
};

export default apiV1;