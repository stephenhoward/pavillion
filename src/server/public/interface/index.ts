import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { EventEmitter } from 'events';
import CalendarEventInstance from '@/common/model/event_instance';
import CalendarInterface from '@/server/calendar/interface';

/**
 * Public interface for calendar operations
 *
 * This interface provides public access to calendar functionality
 * while respecting domain boundaries through dependency injection.
 */
export default class PublicCalendarInterface {
  private calendarInterface: CalendarInterface; // Should be properly typed CalendarInterface when available

  constructor(
    private eventBus: EventEmitter,
    calendarInterface: CalendarInterface,
  ) {
    this.calendarInterface = calendarInterface;
  }

  async getCalendarByName(name: string): Promise<Calendar|null> {
    return this.calendarInterface.getCalendarByName(name);
  }

  async listEventInstances(calendar: Calendar): Promise<CalendarEventInstance[]> {
    return this.calendarInterface.listEventInstancesForCalendar(calendar);
  }

  async getEventById(eventId: string): Promise<CalendarEvent> {
    return this.calendarInterface.getEventById(eventId);
  }

  async getEventInstanceById(instanceId: string): Promise<CalendarEventInstance|null> {
    return this.calendarInterface.getEventInstanceById(instanceId);
  }

}
