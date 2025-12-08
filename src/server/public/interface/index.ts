import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { EventCategory } from '@/common/model/event_category';
import { EventEmitter } from 'events';
import CalendarEventInstance from '@/common/model/event_instance';
import CalendarInterface from '@/server/calendar/interface';
import PublicCalendarService from '@/server/public/service/calendar';

/**
 * Public interface for calendar operations
 *
 * This interface provides public access to calendar functionality
 * while respecting domain boundaries through dependency injection.
 */
export default class PublicCalendarInterface {
  private calendarInterface: CalendarInterface;
  private publicCalendarService: PublicCalendarService;

  constructor(
    private eventBus: EventEmitter,
    calendarInterface: CalendarInterface,
  ) {
    this.calendarInterface = calendarInterface;
    this.publicCalendarService = new PublicCalendarService(calendarInterface);
  }

  async getCalendarByName(name: string): Promise<Calendar|null> {
    return this.calendarInterface.getCalendarByName(name);
  }

  async listEventInstances(calendar: Calendar): Promise<CalendarEventInstance[]> {
    return this.publicCalendarService.listEventInstances(calendar);
  }

  async getEventById(eventId: string): Promise<CalendarEvent> {
    return this.calendarInterface.getEventById(eventId);
  }

  async getEventInstanceById(instanceId: string): Promise<CalendarEventInstance|null> {
    return this.calendarInterface.getEventInstanceById(instanceId);
  }

  async listCategoriesForCalendar(calendar: Calendar): Promise<Array<{category: EventCategory, eventCount: number}>> {
    return this.publicCalendarService.listCategoriesForCalendar(calendar);
  }

  async listEventInstancesWithCategoryFilter(calendar: Calendar, categoryIds: string[]): Promise<CalendarEventInstance[]> {
    return this.publicCalendarService.listEventInstancesWithCategoryFilter(calendar, categoryIds);
  }

  async listEventInstancesWithFilters(calendar: Calendar, options: {
    search?: string;
    categories?: string[];
    startDate?: string;
    endDate?: string;
  }): Promise<CalendarEventInstance[]> {
    return this.publicCalendarService.listEventInstancesWithFilters(calendar, options);
  }

}
