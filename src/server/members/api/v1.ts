import express, { Application, Router } from 'express';
import eventsRouter from './v1/events';
import SiteRoutes from '../../accounts/api/v1/site';
import passport from 'passport';

const apiV1 = (app: Application) => {
    const router = Router();
    app.use(express.json());

    // app.use('/api/v1', passport.authenticate('jwt', { session: false }), eventsRouter);
    app.use('/api/v1', SiteRoutes );
};

export default apiV1;