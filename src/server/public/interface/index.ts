import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { EventCategory } from '@/common/model/event_category';
import { EventSeries } from '@/common/model/event_series';
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

  // Series operations

  /**
   * Get all series for a calendar with their event counts.
   *
   * @param calendar - The calendar to retrieve series for
   * @returns Array of objects with series and eventCount
   */
  async listSeriesForCalendar(calendar: Calendar): Promise<Array<{series: EventSeries, eventCount: number}>> {
    const [seriesList, statsMap] = await Promise.all([
      this.calendarInterface.getSeriesForCalendar(calendar.id),
      this.calendarInterface.getSeriesStats(calendar.id),
    ]);

    return seriesList.map(series => ({
      series,
      eventCount: statsMap.get(series.id) ?? 0,
    }));
  }

  /**
   * Get a series by its URL name within a calendar.
   *
   * @param calendarId - The calendar ID to search within
   * @param urlName - The URL name of the series
   * @returns The EventSeries
   */
  async getSeriesByUrlName(calendarId: string, urlName: string): Promise<EventSeries> {
    return this.calendarInterface.getSeriesByUrlName(calendarId, urlName);
  }

  /**
   * Get all events belonging to a series, with optional pagination.
   *
   * @param seriesId - The ID of the series
   * @param calendarId - Optional calendar ID to verify scope
   * @param limit - Maximum number of events to return (default 20, max 100)
   * @param offset - Number of events to skip (default 0)
   * @returns Paginated array of CalendarEvent
   */
  async getSeriesEvents(
    seriesId: string,
    calendarId?: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<{events: CalendarEvent[], total: number}> {
    const allEvents = await this.calendarInterface.getSeriesEvents(seriesId, calendarId);
    const total = allEvents.length;
    const events = allEvents.slice(offset, offset + limit);
    return { events, total };
  }

}
