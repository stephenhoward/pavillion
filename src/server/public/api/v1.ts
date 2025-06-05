import express, { Application } from 'express';
import CalendarRoutes from '@/server/public/api/v1/calendar';
import PublicCalendarInterface from '../interface';

export default class PublicCalendarAPI {
  static install(app: Application, internalAPI: PublicCalendarInterface): void {
    app.use(express.json());

    let eventsRoutes = new CalendarRoutes(internalAPI);
    eventsRoutes.installHandlers(app, '/api/public/v1');
  }
}
