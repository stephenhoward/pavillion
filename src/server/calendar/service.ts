import express, { Application } from 'express';
import EventProxy from '@/server/common/helper/event_proxy';
import CalendarService from '@/server/calendar/service/calendar';
import EventService from '@/server/calendar/service/events';
import LocationService from '@/server/calendar/service/locations';


class CalendarApplication {

  constructor(app: Application, eventProxy: EventProxy) {
    const calendarSerivce = new CalendarService(eventProxy);
    const eventService = new EventService(eventProxy);
    const locationSerivce = new LocationService(eventProxy);
  }
}
