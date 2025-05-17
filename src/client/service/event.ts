import { CalendarEvent } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';
import { useEventStore } from '@/client/stores/eventStore';
import ModelService from '@/client/service/models';
import { Calendar } from '@/common/model/calendar';

export default class EventService {
  /**
   * Create a new event object
   * @param calendar The calendar to create the event in
   * @returns CalendarEvent A new event instance
   */
  static initEvent(calendar: Calendar): CalendarEvent {
    const event = new CalendarEvent();
    event.location = new EventLocation();
    event.addSchedule();
    // Set the calendar ID so it gets passed to the event creation endpoint
    event.calendarId = calendar.id;
    return event;
  }

  /**
   * Load events for the specified calendar
   * @param calendarUrlName The URL name of the calendar
   * @returns Promise<Array<CalendarEvent>> The events in the calendar
   */
  static async loadCalendarEvents(calendarUrlName: string): Promise<Array<CalendarEvent>> {
    const eventStore = useEventStore();
    try {
      const events = await ModelService.listModels(`/api/v1/calendars/${calendarUrlName}/events`);
      const calendarEvents = events.map(event => CalendarEvent.fromObject(event));
      eventStore.events = calendarEvents;
      return calendarEvents;
    }
    catch (error) {
      console.error('Error loading calendar events:', error);
      throw error;
    }
  }

  /**
   * Save an event (create or update)
   * @param event The event to save
   * @returns Promise<CalendarEvent> The saved event
   */
  static async createEvent(event: CalendarEvent): Promise<CalendarEvent> {
    const eventStore = useEventStore();
    const isNew = !event.id;

    if (!event.calendarId) {
      throw new Error('Event must have a calendarId');
    }

    try {
      let savedEvent: CalendarEvent;

      if (isNew) {
        const createdEvent = await ModelService.createModel(
          event,
          `/api/v1/calendars/${event.calendarId}/events`,
        );
        savedEvent = CalendarEvent.fromObject(createdEvent);
        eventStore.addEvent(savedEvent);
      }
      else {
        const updatedEvent = await ModelService.updateModel(
          event,
          `/api/v1/calendars/${event.calendarId}/events`,
        );
        savedEvent = CalendarEvent.fromObject(updatedEvent);
        eventStore.updateEvent(savedEvent);
      }

      return savedEvent;
    }
    catch (error) {
      console.error('Error saving event:', error);
      throw error;
    }
  }
}
