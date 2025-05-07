import express, { Application } from 'express';
import EventRoutes from '@/server/calendar/api/v1/events';
import CalendarRoutes from '@/server/calendar/api/v1/calendar';
import EventProxy from '@/server/common/helper/event_proxy';

class EventAPI extends EventProxy{
  app: Application;

  constructor(app: Application) {
    super();
    this.app = app;

    let eventsRoutes = new EventRoutes();
    let calendarRoutes = new CalendarRoutes();
    this.proxyEvents(eventsRoutes,['eventCreated', 'eventUpdated']);

    app.use(express.json());
    app.use('/api/v1', eventsRoutes.router );
    app.use('/api/v1', calendarRoutes.router );
  }
}

export default EventAPI;
