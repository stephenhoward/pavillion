import express, { Application } from 'express';
import EventRoutes from '@/server/calendar/api/v1/events';
import CalendarRoutes from '@/server/calendar/api/v1/calendar';
import EditorRoutes from '@/server/calendar/api/v1/editors';
import CategoryRoutes from '@/server/calendar/api/v1/categories';
import WidgetRoutes from '@/server/calendar/api/v1/widget';
import WidgetConfigRoutes from '@/server/calendar/api/v1/widget-config';
import CalendarInterface from '../interface';

export default class CalendarAPI {

  static install(app: Application, internalAPI: CalendarInterface): void {
    app.use(express.json());

    let eventsRoutes = new EventRoutes(internalAPI);
    eventsRoutes.installHandlers(app, '/api/v1');
    let calendarRoutes = new CalendarRoutes(internalAPI);
    calendarRoutes.installHandlers(app, '/api/v1');
    let editorRoutes = new EditorRoutes(internalAPI);
    editorRoutes.installHandlers(app, '/api/v1');
    let categoryRoutes = new CategoryRoutes(internalAPI);
    categoryRoutes.installHandlers(app, '/api/v1');
    // Widget configuration routes for admin interface
    let widgetConfigRoutes = new WidgetConfigRoutes(internalAPI);
    widgetConfigRoutes.installHandlers(app, '/api/v1');
    // Widget routes with separate prefix for widget-specific endpoints
    let widgetRoutes = new WidgetRoutes(internalAPI);
    widgetRoutes.installHandlers(app, '/api/widget/v1');
  }
}
