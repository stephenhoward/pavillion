import express, { Application } from 'express';
import CalendarRoutes from '@/server/public/api/v1/calendar';
import PublicCalendarInterface from '../interface';

export default class PublicCalendarAPI {
  static install(app: Application, internalAPI: PublicCalendarInterface): void {
    // Scoped, not global: a bare app.use(express.json()) would also consume
    // raw-body routes like the Stripe webhook (/api/funding/webhooks) (pv-ufag).
    app.use('/api/public/v1', express.json());

    let eventsRoutes = new CalendarRoutes(internalAPI);
    eventsRoutes.installHandlers(app, '/api/public/v1');
  }
}
