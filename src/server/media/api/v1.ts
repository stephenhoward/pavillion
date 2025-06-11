import express, { Application } from 'express';
import MediaInterface from '../interface';
import MediaRoutes from './v1/media';

export default class MediaAPI {

  static install(app: Application, internalAPI: MediaInterface): void {
    app.use(express.json());

    let mediaRoutes = new MediaRoutes(internalAPI);
    mediaRoutes.installHandlers(app, '/api/v1/media');
  }
}
