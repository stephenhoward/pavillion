import express, { Application } from 'express';
import { router as eventsRoutes } from '@/server/members/api/v1/events';

const apiV1 = (app: Application) => {

    app.use(express.json());
    app.use('/api/v1', eventsRoutes );
};

export default apiV1;