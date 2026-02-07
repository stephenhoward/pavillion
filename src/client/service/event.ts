import { CalendarEvent } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';
import { useEventStore } from '@/client/stores/eventStore';
import ModelService from '@/client/service/models';
import { Calendar } from '@/common/model/calendar';
import { validateAndEncodeId } from '@/client/service/utils';

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
   * @param filters Optional search and filter parameters
   * @returns Promise<Array<CalendarEvent>> The events in the calendar
   */
  async loadCalendarEvents(
    calendarUrlName: string,
    filters?: {
      search?: string;
      categories?: string[];
    },
  ): Promise<Array<CalendarEvent>> {
    try {
      const encodedUrlName = validateAndEncodeId(calendarUrlName, 'Calendar URL name');
      let url = `/api/v1/calendars/${encodedUrlName}/events`;

      // Add query parameters if filters are provided
      if (filters && Object.keys(filters).length > 0) {
        const params = new URLSearchParams();

        if (filters.search) {
          params.append('search', filters.search);
        }

        if (filters.categories && filters.categories.length > 0) {
          // Send categories as comma-separated string
          params.append('categories', filters.categories.join(','));
        }

        url += `?${params.toString()}`;
      }

      const events = await ModelService.listModels(url);
      const calendarEvents = events.items.map(event => CalendarEvent.fromObject(event));
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
  async saveEvent(event: CalendarEvent): Promise<CalendarEvent> {
    const isNew = !event.id;

    if (!event.calendarId) {
      throw new Error('Event must have a calendarId');
    }

    try {
      let savedEvent: CalendarEvent;
      const url = `/api/v1/events`;

      if (isNew) {
        const responseData = await ModelService.createModel(event, url);
        savedEvent = CalendarEvent.fromObject(responseData);
        this.store.addEvent(savedEvent);
      }
      else {
        const responseData = await ModelService.updateModel(event, url);
        savedEvent = CalendarEvent.fromObject(responseData);
        this.store.updateEvent(savedEvent);
      }

      return savedEvent;
    }
    catch (error) {
      console.error('Error saving event:', error);
      throw error;
    }
  }

  /**
   * Delete an event
   * @param eventId The ID of the event to delete
   * @returns Promise<void>
   */
  async deleteEvent(event: CalendarEvent): Promise<void> {
    try {
      await ModelService.deleteModel(event, '/api/v1/events');
      this.store.removeEvent(event);
    }
    catch (error) {
      console.error('Error deleting event:', error);
      throw error;
    }
  }

  /**
   * Strips IDs and auto-generated fields from an event to prepare for duplication.
   * Creates a copy of the event with all identifying fields cleared while preserving
   * content, location data, media data, schedules, and categories.
   *
   * @param originalEvent The event to prepare for duplication
   * @returns CalendarEvent A new event instance ready for duplication
   */
  static prepareEventForDuplication(originalEvent: CalendarEvent): CalendarEvent {
    const duplicatedEvent = originalEvent.clone();

    // Clear primary identifiers
    duplicatedEvent.id = '';
    duplicatedEvent.eventSourceUrl = '';

    // Clear location ID if it exists, but preserve location data
    if (duplicatedEvent.location) {
      duplicatedEvent.location.id = '';
    }

    // Clear media ID if it exists, but preserve media data
    if (duplicatedEvent.media) {
      duplicatedEvent.media.id = '';
    }
    duplicatedEvent.mediaId = null;

    // Clear schedule IDs but preserve schedule data
    duplicatedEvent.schedules.forEach(schedule => {
      schedule.id = '';
    });

    // Clear category IDs but preserve category data and relationships
    duplicatedEvent.categories.forEach(category => {
      category.id = '';
    });

    return duplicatedEvent;
  }
}
