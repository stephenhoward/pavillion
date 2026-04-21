import axios from 'axios';
import { CalendarEvent } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';
import { useEventStore } from '@/client/stores/eventStore';
import ModelService from '@/client/service/models';
import { Calendar } from '@/common/model/calendar';
import { validateAndEncodeId } from '@/client/service/utils';

export interface UpcomingOccurrence {
  start: string;          // ISO-8601 datetime
  state: 'active' | 'cancelled-shown' | 'hidden';
  scheduleId: string | null;
}

export interface UpcomingOccurrencesResult {
  occurrences: UpcomingOccurrence[];
  hasMore: boolean;
}

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
   * Fetch upcoming occurrences for a recurring event computed from its
   * RRuleSet on the server. Independent of the materialization horizon —
   * the caller controls the window via (after, limit).
   *
   * @param eventId The recurring event id
   * @param after ISO-8601 datetime; defaults to server "now" when omitted
   * @param limit Max occurrences to return (default server-side: 10)
   */
  async listUpcomingOccurrences(
    eventId: string,
    after?: string,
    limit?: number,
  ): Promise<UpcomingOccurrencesResult> {
    const encodedEventId = validateAndEncodeId(eventId, 'Event ID');
    const params = new URLSearchParams();
    if (after) params.append('after', after);
    if (limit) params.append('limit', String(limit));
    const suffix = params.toString() ? `?${params.toString()}` : '';

    try {
      const response = await axios.get(
        `/api/v1/events/${encodedEventId}/upcoming-occurrences${suffix}`,
      );
      return response.data as UpcomingOccurrencesResult;
    }
    catch (error) {
      console.error('Error listing upcoming occurrences:', error);
      throw error;
    }
  }

  /**
   * Cancel a specific occurrence of a recurring event by its start date.
   * Server validates the date matches the RRuleSet; mismatched dates throw
   * a 422.
   */
  async cancelOccurrence(
    eventId: string,
    start: string,
    hideFromPublic: boolean,
  ): Promise<void> {
    const encodedEventId = validateAndEncodeId(eventId, 'Event ID');
    try {
      await axios.post(
        `/api/v1/events/${encodedEventId}/occurrences/cancel`,
        { start, hideFromPublic },
      );
    }
    catch (error) {
      console.error('Error cancelling event occurrence:', error);
      throw error;
    }
  }

  /**
   * Restore a previously cancelled occurrence by its start date. Silent no-op
   * server-side if the occurrence was never cancelled.
   */
  async restoreOccurrence(eventId: string, start: string): Promise<void> {
    const encodedEventId = validateAndEncodeId(eventId, 'Event ID');
    try {
      await axios.delete(
        `/api/v1/events/${encodedEventId}/occurrences/cancel`,
        { data: { start } },
      );
    }
    catch (error) {
      console.error('Error restoring event occurrence:', error);
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
