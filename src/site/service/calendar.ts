import { DateTime } from 'luxon';
import { Calendar } from '@/common/model/calendar';
import ModelService from '@/client/service/models';
import { UrlNameAlreadyExistsError, InvalidUrlNameError } from '@/common/exceptions/calendar';
import { UnauthenticatedError, UnknownError, EmptyValueError } from '@/common/exceptions';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { CalendarEvent } from '@/common/model/events';
import { useEventStore } from '@/client/stores/eventStore';
import { startAndEndDates } from '@/common/model/events';

const errorMap = {
  UrlNameAlreadyExistsError,
  InvalidUrlNameError,
  UnauthenticatedError,
  UnknownError,
};

type EventInstance = {
  event: CalendarEvent;
  start: DateTime;
  end: DateTime|null;
};

export default class CalendarService {
  store: ReturnType<typeof useCalendarStore>;
  eventStore: ReturnType<typeof useEventStore>;

  constructor(store: ReturnType<typeof useCalendarStore> = useCalendarStore(), eventStore: ReturnType<typeof useEventStore> = useEventStore()) {
    this.store = store;
    this.eventStore = eventStore;
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
    const calendarData = await ModelService.getModel('/api/public/v1/calendars/' + urlName);
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
  async loadCalendarEvents(calendarUrlName: string): Promise<Array<CalendarEvent>> {
    try {
      const events = await ModelService.listModels(`/api/public/v1/calendars/${calendarUrlName}/events`);
      const calendarEvents = events.map(event => CalendarEvent.fromObject(event));
      this.eventStore.setEvents(calendarEvents);
      return calendarEvents;
    }
    catch (error) {
      console.error('Error loading calendar events:', error);
      throw error;
    }
  }


  async loadCalendarEventsByDay(calendarUrlName: string): Promise<Record<string, Array<EventInstance>>> {
    const events = await this.loadCalendarEvents(calendarUrlName);
    const eventsByDay: Record<string,Array<EventInstance>> = {};
    events.forEach((event: CalendarEvent) => {
      event.instances(10).forEach((datetimes: startAndEndDates) => {
        const dateKey = datetimes.start.toISODate();
        if ( dateKey ) {
          if (!eventsByDay[dateKey]) {
            eventsByDay[dateKey] = [];
          }
          eventsByDay[dateKey].push({
            event: event,
            start: datetimes.start,
            end: datetimes.end,
          });
        }
      });
    });
    return eventsByDay;
  }

  async loadEvent(eventId: string): Promise<CalendarEvent|null> {
    try {
      const event = await ModelService.getModel(`/api/public/v1/events/${eventId}`);
      if (event) {
        const calendarEvent = CalendarEvent.fromObject(event);
        this.eventStore.addEvent(calendarEvent);
        return calendarEvent;
      }
      return null;
    }
    catch (error) {
      console.error('Error loading event:', error);
      throw error;
    }
  }
}
