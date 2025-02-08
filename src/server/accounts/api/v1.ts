import express, { Application, Router } from 'express';
import { router as AccountRoutes } from './v1/accounts';
import { router as AccountInvitationRoutes } from './v1/invitations';
import { router as AccountApplicationRoutes } from './v1/applications';

const apiV1 = (app: Application) => {

    app.use(express.json());
    app.use('/api/accounts/v1', AccountRoutes);
    app.use('/api/accounts/v1', AccountInvitationRoutes);
    app.use('/api/accounts/v1', AccountApplicationRoutes );
};

export default apiV1;