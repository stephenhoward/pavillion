import express, { Application, Router } from 'express';
import AdminRoutes from './v1/admin';
import SiteRoutes from './v1/site';

const apiV1 = (app: Application) => {

    const router = Router();
    app.use(express.json());
    app.use('/api/admin/v1', AdminRoutes);
    app.use('/api/admin/v1', SiteRoutes );
};

export default apiV1;