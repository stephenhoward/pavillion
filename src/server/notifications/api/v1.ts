import express, { Application } from 'express';

import NotificationRoutes from '@/server/notifications/api/v1/notification';
import NotificationsInterface from '@/server/notifications/interface';

export default class NotificationAPI {

  static install(app: Application, internalAPI: NotificationsInterface): void {
    app.use(express.json());

    const notificationRoutes = new NotificationRoutes(internalAPI);
    notificationRoutes.installHandlers(app, '/api/v1');
  }
}
