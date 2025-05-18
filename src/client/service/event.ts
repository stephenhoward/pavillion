import { CalendarEvent } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';
import { useEventStore } from '@/client/stores/eventStore';
import ModelService from '@/client/service/models';
import { Calendar } from '@/common/model/calendar';

export default class EventService {
  store: ReturnType<typeof useEventStore>;

  /**
   * Constructor that accepts an event store instance
   * @param store The event store to use (defaults to useEventStore())
   */
  constructor(store: ReturnType<typeof useEventStore> = useEventStore()) {
    this.store = store;
  }

  /**
   * Create a new event object
   * @param calendar The calendar to create the event in
   * @returns CalendarEvent A new event instance
   */
  initEvent(calendar: Calendar): CalendarEvent {
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
  async loadCalendarEvents(calendarUrlName: string): Promise<Array<CalendarEvent>> {
    try {
      const events = await ModelService.listModels(`/api/v1/calendars/${calendarUrlName}/events`);
      const calendarEvents = events.map(event => CalendarEvent.fromObject(event));
      this.store.events = calendarEvents;
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
  async createEvent(event: CalendarEvent): Promise<CalendarEvent> {
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
        this.store.addEvent(savedEvent);
      }
      else {
        const updatedEvent = await ModelService.updateModel(
          event,
          `/api/v1/calendars/${event.calendarId}/events`,
        );
        savedEvent = CalendarEvent.fromObject(updatedEvent);
        this.store.updateEvent(savedEvent);
      }

      return savedEvent;
    }
    catch (error) {
      console.error('Error saving event:', error);
      throw error;
    }
  }
}
