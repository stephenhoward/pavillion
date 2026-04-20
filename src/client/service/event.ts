import axios from 'axios';
import { CalendarEvent } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';
import CalendarEventInstance from '@/common/model/event_instance';
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
   * Load events for the specified calendar and update the store.
   *
   * When calendarId is provided, the store is always updated - even when the
   * API returns zero results (e.g. all events filtered out by category). Without
   * calendarId the store can only be updated when at least one event comes back,
   * because the calendar UUID is derived from the first result.
   *
   * @param calendarUrlName The URL name of the calendar
   * @param filters Optional search and filter parameters
   * @param calendarId Optional calendar UUID used to update the store when the result set is empty
   * @returns Promise<Array<CalendarEvent>> The events in the calendar
   */
  async loadCalendarEvents(
    calendarUrlName: string,
    filters?: {
      search?: string;
      categories?: string[];
    },
    calendarId?: string,
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

      // Resolve the store key: prefer the explicit calendarId parameter, fall back to the
      // ID from the first result. The explicit parameter must take precedence because reposted
      // events carry the original owner's calendarId, not the requesting calendar's ID.
      const storeCalendarId = calendarId
        ?? (calendarEvents.length > 0 ? calendarEvents[0].calendarId : undefined);

      if (storeCalendarId) {
        this.store.setEventsForCalendar(storeCalendarId, calendarEvents);
      }

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
        this.store.addEvent(savedEvent.calendarId!, savedEvent);
      }
      else {
        const responseData = await ModelService.updateModel(event, url);
        savedEvent = CalendarEvent.fromObject(responseData);
        this.store.updateEvent(savedEvent.calendarId!, savedEvent);
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
      if (event.calendarId) {
        this.store.removeEvent(event.calendarId, event);
      }
    }
    catch (error) {
      console.error('Error deleting event:', error);
      throw error;
    }
  }

  /**
   * Remove a reposted event from a calendar (writes a sticky dismissal on the backend
   * so the event is not silently re-auto-posted on the next broadcast). Thin wrapper
   * over DELETE /api/v1/social/shares so calendar-management components do not need
   * to reach into FeedService.
   *
   * @param calendarId The calendar holding the repost
   * @param event The reposted event to remove
   */
  async unshareReposted(calendarId: string, event: CalendarEvent): Promise<void> {
    try {
      await ModelService.delete(`/api/v1/social/shares/${encodeURIComponent(event.id)}?calendarId=${calendarId}`);
      this.store.removeEvent(calendarId, event);
    }
    catch (error) {
      console.error('Error unsharing reposted event:', error);
      throw error;
    }
  }

  /**
   * Cancel a single materialized instance of a recurring event. The server
   * distinguishes between EXDATE-style hidden cancellation (hideFromPublic=true,
   * instance disappears) and RECURRENCE-ID-style shown cancellation
   * (hideFromPublic=false, instance remains visible with a cancelled marker).
   *
   * Updates the eventStore's cached instance in place so the panel UI reflects
   * the new state without a full refetch — or removes it from the cache when
   * the server reports the instance no longer materializes (null response).
   *
   * @param eventId The event whose instance is being cancelled
   * @param instanceId The materialized instance id to cancel
   * @param hideFromPublic True for EXDATE-style hidden cancellation, false for shown
   * @returns The updated instance, or null if the cancellation removes it from view
   */
  async cancelEventInstance(
    eventId: string,
    instanceId: string,
    hideFromPublic: boolean,
  ): Promise<CalendarEventInstance | null> {
    const encodedEventId = validateAndEncodeId(eventId, 'Event ID');
    const encodedInstanceId = validateAndEncodeId(instanceId, 'Instance ID');

    try {
      const response = await axios.post(
        `/api/v1/events/${encodedEventId}/instances/${encodedInstanceId}/cancel`,
        { hideFromPublic },
      );

      if (response.data) {
        const instance = CalendarEventInstance.fromObject(response.data);
        this.store.updateInstance(eventId, instance);
        return instance;
      }

      // Hidden cancellation: the server no longer materializes this instance,
      // so drop it from the cache to keep the panel consistent.
      this.store.removeInstance(eventId, instanceId);
      return null;
    }
    catch (error) {
      console.error('Error cancelling event instance:', error);
      throw error;
    }
  }

  /**
   * Restore a previously cancelled instance by removing its exclusion schedule
   * row on the server. Updates the cached instance in place on response.
   *
   * @param eventId The event whose instance is being restored
   * @param instanceId The materialized instance id to restore
   * @returns The updated instance, or null if the server could not re-materialize it
   */
  async restoreEventInstance(
    eventId: string,
    instanceId: string,
  ): Promise<CalendarEventInstance | null> {
    const encodedEventId = validateAndEncodeId(eventId, 'Event ID');
    const encodedInstanceId = validateAndEncodeId(instanceId, 'Instance ID');

    try {
      const response = await axios.delete(
        `/api/v1/events/${encodedEventId}/instances/${encodedInstanceId}/cancel`,
      );

      if (response.data) {
        const instance = CalendarEventInstance.fromObject(response.data);
        this.store.updateInstance(eventId, instance);
        return instance;
      }

      return null;
    }
    catch (error) {
      console.error('Error restoring event instance:', error);
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
