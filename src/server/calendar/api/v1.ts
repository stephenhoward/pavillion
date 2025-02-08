import express, { Application } from 'express';
import EventRoutes from '@/server/calendar/api/v1/events';
import EventProxy from '@/server/common/helper/event_proxy';

class EventAPI extends EventProxy{
    app: Application;

    constructor(app: Application) {
        super();
        this.app = app;

        let eventsRoutes = new EventRoutes();
        this.proxyEvents(eventsRoutes,['eventCreated', 'eventUpdated']);

        app.use(express.json());
        app.use('/api/v1', eventsRoutes.router );
    }
}

export default EventAPI;