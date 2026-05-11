import { DateTime } from 'luxon';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import ModelService from '@/client/service/models';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useEventInstanceStore } from '@/site/stores/eventInstanceStore';
import CalendarEventInstance from '@/common/model/event_instance';
import { CalendarEvent } from '@/common/model/events';
import { EventSeries } from '@/common/model/event_series';
import { formatInstanceSlug } from '@/common/utils/instance-slug';

export type SeriesDetail = {
  series: EventSeries;
  events: CalendarEvent[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
};

/**
 * A single row from the public discovery listing.
 *
 * The backend returns lastEventActivity as an ISO 8601 string (or null) — the
 * service keeps the Calendar hydrated so locale-aware content lookups can run
 * via useLocalizedContent on the consuming component.
 */
export type PublicCalendarListing = {
  calendar: Calendar;
  lastEventActivity: string | null;
};

export default class CalendarService {
  store: ReturnType<typeof useCalendarStore>;
  eventStore: ReturnType<typeof useEventInstanceStore>;

  constructor(store: ReturnType<typeof useCalendarStore> = useCalendarStore(), eventStore: ReturnType<typeof useEventInstanceStore> = useEventInstanceStore()) {
    this.store = store;
    this.eventStore = eventStore;
  }


  /**
   * List public discoverable calendars for the /view/ landing page.
   *
   * Calls GET /api/public/v1/calendars, which returns a bare array of
   * { id, urlName, content[], lastEventActivity } rows sorted by
   * lastEventActivity descending (server-provided order — the caller does
   * NOT re-sort).
   *
   * Each row's `content` field is an array of { language, name, description }
   * which we adapt into Calendar instances so the component can pick the
   * visitor's locale via useLocalizedContent (which operates on TranslatedModel).
   *
   * @returns Promise resolving to an array of { calendar, lastEventActivity }
   *   tuples in the server's order. Throws on network or 5xx error.
   */
  async listPublicCalendars(): Promise<PublicCalendarListing[]> {
    const result = await ModelService.listModels('/api/public/v1/calendars');
    return result.items.map((row: Record<string, any>) => {
      const calendar = new Calendar(row.id, row.urlName);
      if (Array.isArray(row.content)) {
        for (const c of row.content) {
          if (c && typeof c === 'object' && typeof c.language === 'string') {
            calendar.addContent(new CalendarContent(c.language, c.name ?? '', c.description ?? ''));
          }
        }
      }
      return {
        calendar,
        lastEventActivity: row.lastEventActivity ?? null,
      };
    });
  }

  /**
   * Get a calendar by its URL name
   * @param urlName The URL name of the calendar
   * @returns Promise<Calendar|null> The calendar or null if not found
   */
  async getCalendarByUrlName(urlName: string): Promise<Calendar | null> {
    // Find the calendar by URL name in the store
    let calendar = this.store.getCalendarByUrlName(urlName);
    if (calendar) {
      return calendar;
    }
    const calendarData = await ModelService.getModel('/api/public/v1/calendar/' + urlName);
    if ( calendarData) {
      calendar = Calendar.fromObject(calendarData);
      // Update the store with the fetched calendar
      this.store.addCalendar(calendar);
      return calendar;
    }

    return null;
  }

  /**
   * Load events for the specified calendar
   * @param calendarUrlName The URL name of the calendar
   * @returns Promise<Array<CalendarEvent>> The events in the calendar
   */
  async loadCalendarEvents(calendarUrlName: string): Promise<CalendarEventInstance[]> {
    try {
      const events = await ModelService.listModels(`/api/public/v1/calendar/${calendarUrlName}/events`);
      const calendarEvents = events.items.map(event => CalendarEventInstance.fromObject(event));
      this.eventStore.setEvents(calendarEvents);
      return calendarEvents;
    }
    catch (error) {
      console.error('Error loading calendar events:', error);
      throw error;
    }
  }


  async loadCalendarEventsByDay(calendarUrlName: string): Promise<Record<string, CalendarEventInstance[]>> {
    const events = await this.loadCalendarEvents(calendarUrlName);
    const eventsByDay: Record<string,CalendarEventInstance[]> = {};
    events.forEach((instance: CalendarEventInstance) => {
      const dateKey = instance.start.toISODate();
      if ( dateKey ) {
        if (!eventsByDay[dateKey]) {
          eventsByDay[dateKey] = [];
        }
        console.debug('Adding event to day:', dateKey, instance);
        eventsByDay[dateKey].push(instance);
      }
    });
    return eventsByDay;
  }

  /**
   * Load a single event instance by its parent event id and UTC start time.
   *
   * The start time is serialized as a minute-precision slug (`yyyymmdd-hhmm`)
   * and appended to the nested public route
   * `/api/public/v1/events/:eventId/instances/:startTime`. The DateTime is
   * converted to UTC before formatting, so callers may pass a zoned value.
   *
   * When `calendarUrlName` is supplied it is forwarded as `?calendar=<urlName>`
   * so the backend scopes category mappings to that display calendar — needed
   * for reposted events where the originating calendar's categories should be
   * suppressed in favor of the reposting calendar's.
   *
   * @param eventId - The parent event id (UUID)
   * @param startTime - The instance's start time; converted to UTC for the slug
   * @param calendarUrlName - Optional display calendar URL name
   * @returns The loaded instance, or `null` if the backend returned 404
   */
  async loadEventInstance(
    eventId: string,
    startTime: DateTime,
    calendarUrlName?: string,
  ): Promise<CalendarEventInstance | null> {
    try {
      const slug = formatInstanceSlug(startTime);
      const path = `/api/public/v1/events/${eventId}/instances/${slug}`;
      const url = calendarUrlName
        ? `${path}?calendar=${encodeURIComponent(calendarUrlName)}`
        : path;
      const instance = await ModelService.getModel(url);
      if (instance) {
        const calendarEvent = CalendarEventInstance.fromObject(instance);
        this.eventStore.addEvent(calendarEvent);
        return calendarEvent;
      }
      return null;
    }
    catch (error) {
      console.error('Error loading instance:', error);
      throw error;
    }
  }


  async loadEvent(eventId: string, calendarUrlName?: string): Promise<CalendarEvent|null> {
    try {
      const path = `/api/public/v1/events/${eventId}`;
      const url = calendarUrlName
        ? `${path}?calendar=${encodeURIComponent(calendarUrlName)}`
        : path;
      const event = await ModelService.getModel(url);
      if (event) {
        const calendarEvent = CalendarEvent.fromObject(event);
        return calendarEvent;
      }
      return null;
    }
    catch (error) {
      console.error('Error loading event:', error);
      throw error;
    }
  }

  /**
   * Load the list of series for a calendar.
   *
   * @param calendarUrlName - The URL name of the calendar
   * @returns Array of plain series objects with eventCount, or empty array
   */
  async loadSeriesList(calendarUrlName: string): Promise<Array<Record<string, any>>> {
    try {
      const result = await ModelService.listModels(`/api/public/v1/calendar/${calendarUrlName}/series`);
      return result.items;
    }
    catch (error) {
      console.error('Error loading series list:', error);
      throw error;
    }
  }

  /**
   * Load series detail including the paginated event list.
   *
   * @param calendarUrlName - The URL name of the calendar
   * @param seriesUrlName - The URL name of the series
   * @param limit - Number of events per page (default 20)
   * @param offset - Pagination offset (default 0)
   * @returns SeriesDetail object or null if not found
   */
  async loadSeriesDetail(
    calendarUrlName: string,
    seriesUrlName: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<SeriesDetail | null> {
    try {
      const url = `/api/public/v1/calendar/${calendarUrlName}/series/${seriesUrlName}?limit=${limit}&offset=${offset}`;
      const data = await ModelService.getModel(url);
      if (!data) {
        return null;
      }

      // The response merges series fields with events and pagination
      const series = EventSeries.fromObject(data);
      const events = (data.events || []).map((e: Record<string, any>) => CalendarEvent.fromObject(e));
      const pagination = data.pagination || { total: 0, limit, offset };

      return { series, events, pagination };
    }
    catch (error) {
      console.error('Error loading series detail:', error);
      throw error;
    }
  }
}
