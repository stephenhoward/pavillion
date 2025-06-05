import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import CalendarService from '@/server/calendar/service/calendar';
import EventService from '@/server/calendar/service/events';
import { EventEmitter } from 'events';
import EventInstanceService from '@/server/calendar/service/event_instance';
import CalendarEventInstance from '@/common/model/event_instance';

export default class PublicCalendarInterface {
  private calendarService: CalendarService;
  private eventService: EventService;
  private eventInstanceService: EventInstanceService;

  constructor(eventBus: EventEmitter ) {
    this.calendarService = new CalendarService();
    this. eventService = new EventService(eventBus);
    this.eventInstanceService = new EventInstanceService(eventBus);
  }

  async getCalendarByName(name: string): Promise<Calendar|null> {
    return this.calendarService.getCalendarByName(name);
  }

  async listEventInstances(calendar: Calendar): Promise<CalendarEventInstance[]> {
    return this.eventInstanceService.listEventInstancesForCalendar(calendar);
  }

  async getEventById(eventId: string): Promise<CalendarEvent> {
    return this.eventService.getEventById(eventId);
  }

}
