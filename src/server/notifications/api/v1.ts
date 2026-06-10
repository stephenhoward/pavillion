import express, { Application } from 'express';

import NotificationRoutes from '@/server/notifications/api/v1/notification';
import NotificationsInterface from '@/server/notifications/interface';

export default class NotificationAPI {

  static install(app: Application, internalAPI: NotificationsInterface): void {
    // Scoped, not global: a bare app.use(express.json()) would also consume
    // raw-body routes like the Stripe webhook (/api/funding/webhooks) (pv-ufag).
    app.use('/api/v1', express.json());

    const notificationRoutes = new NotificationRoutes(internalAPI);
    notificationRoutes.installHandlers(app, '/api/v1');
  }
}
