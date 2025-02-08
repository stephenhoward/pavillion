import express, { Application } from 'express';
import { router as ConfigRoutes } from '@/server/configuration/api/v1/site';

const apiV1 = (app: Application) => {

    app.use(express.json());
    app.use('/api/config/v1', ConfigRoutes);
};

export default apiV1;