import express, { Application, Router } from 'express';
import eventsRouter from './v1/events';
import AuthRoutes from './v1/auth';
import SiteRoutes from './v1/site';
import passport from 'passport';

const apiV1 = (app: Application) => {
    const router = Router();
    app.use(express.json());

    // app.use('/api/v1', passport.authenticate('jwt', { session: false }), eventsRouter);
    app.use('/api/v1/auth', AuthRoutes);
    app.use('/api/v1', SiteRoutes );
};

export default apiV1;