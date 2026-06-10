import express, { Application } from 'express';
import MediaInterface from '../interface';
import MediaRoutes from './v1/media';

export default class MediaAPI {

  static install(app: Application, internalAPI: MediaInterface): void {
    // Scoped, not global: a bare app.use(express.json()) would also consume
    // raw-body routes like the Stripe webhook (/api/funding/webhooks) (pv-ufag).
    app.use('/api/v1/media', express.json());

    let mediaRoutes = new MediaRoutes(internalAPI);
    mediaRoutes.installHandlers(app, '/api/v1/media');
  }
}
