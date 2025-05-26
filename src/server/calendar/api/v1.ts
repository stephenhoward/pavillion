import express, { Application } from 'express';
import EventRoutes from '@/server/calendar/api/v1/events';
import CalendarRoutes from '@/server/calendar/api/v1/calendar';
import CalendarInterface from '../interface';

export default class CalendarAPI {

  static install(app: Application, internalAPI: CalendarInterface): void {
    app.use(express.json());

    let eventsRoutes = new EventRoutes(internalAPI);
    eventsRoutes.installHandlers(app, '/api/v1');
    let calendarRoutes = new CalendarRoutes(internalAPI);
    calendarRoutes.installHandlers(app, '/api/v1');
  }
}
