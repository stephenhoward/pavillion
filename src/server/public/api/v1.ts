import express, { Application } from 'express';
import CalendarRoutes from '@/server/public/api/v1/calendar';

class EventAPI {
  app: Application;

  constructor(app: Application) {
    this.app = app;

    let calendarRoutes = new CalendarRoutes();

    app.use(express.json());
    app.use('/api/public/v1', calendarRoutes.router );
  }
}

export default EventAPI;
