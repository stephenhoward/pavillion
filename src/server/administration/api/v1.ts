import express, { Application, Router } from 'express';
import AdminRoutes from './v1/admin';

const apiV1 = (app: Application) => {

    const router = Router();
    app.use(express.json());
    app.use('/api/admin/v1', AdminRoutes);
};

export default apiV1;