import axios from 'axios';
import { EventSeries } from '@/common/model/event_series';
import { SeriesNotFoundError, SeriesUrlNameAlreadyExistsError, InvalidSeriesUrlNameError, DuplicateSeriesNameError, SeriesEventCalendarMismatchError } from '@/common/exceptions/series';
import { CalendarNotFoundError, InsufficientCalendarPermissionsError, EventNotFoundError } from '@/common/exceptions/calendar';
import { UnauthenticatedError, UnknownError } from '@/common/exceptions';
import { useSeriesStore } from '@/client/stores/seriesStore';
import ModelService from '@/client/service/models';
import { validateAndEncodeId, handleApiError } from '@/client/service/utils';

const errorMap = {
  SeriesNotFoundError,
  SeriesUrlNameAlreadyExistsError,
  InvalidSeriesUrlNameError,
  DuplicateSeriesNameError,
  SeriesEventCalendarMismatchError,
  CalendarNotFoundError,
  InsufficientCalendarPermissionsError,
  EventNotFoundError,
  UnauthenticatedError,
  UnknownError,
};

export default class SeriesService {
  store: ReturnType<typeof useSeriesStore>;

  /**
   * Constructor that accepts a series store instance.
   *
   * @param store The series store to use (defaults to useSeriesStore())
   */
  constructor(store: ReturnType<typeof useSeriesStore> = useSeriesStore()) {
    this.store = store;
  }

  /**
   * Load all series for a specific calendar with event counts.
   *
   * @param calendarId - The ID of the calendar
   * @returns Promise<Array<EventSeries & { eventCount: number }>> The list of series with event counts
   */
  async loadSeries(calendarId: string): Promise<Array<EventSeries & { eventCount: number }>> {
    const encodedId = validateAndEncodeId(calendarId, 'Calendar ID');

    try {
      const response = await axios.get(`/api/v1/calendars/${encodedId}/series`);
      const seriesWithCounts = response.data.map((seriesData: any) => {
        const series = EventSeries.fromObject(seriesData);
        return Object.assign(series, { eventCount: seriesData.eventCount || 0 });
      });
      this.store.setSeriesForCalendar(calendarId, seriesWithCounts);
      return seriesWithCounts;
    }
    catch (error) {
      console.error('Error loading calendar series:', error);
      throw error;
    }
  }

  /**
   * Save a series (create new or update existing).
   *
   * @param series - The series object with content for all languages
   * @returns Promise<EventSeries> The saved series
   */
  async saveSeries(series: EventSeries): Promise<EventSeries> {
    const isNew = !series.id;
    const calendarId = series.calendarId;

    if (!calendarId) {
      throw new Error('Series must have a calendarId');
    }

    const encodedCalendarId = validateAndEncodeId(series.calendarId, 'Calendar ID');

    try {
      let savedSeries: EventSeries;
      const url = `/api/v1/calendars/${encodedCalendarId}/series`;

      if (isNew) {
        const responseData = await ModelService.createModel(series, url);
        savedSeries = EventSeries.fromObject(responseData);
        this.store.addSeries(calendarId, savedSeries);
      }
      else {
        const responseData = await ModelService.updateModel(series, url);
        savedSeries = EventSeries.fromObject(responseData);
        this.store.updateSeries(calendarId, savedSeries);
      }

      return savedSeries;
    }
    catch (error: unknown) {
      console.error('Error saving series:', error);
      handleApiError(error, errorMap);
    }
  }

  /**
   * Get a specific series by ID.
   *
   * @param seriesId - The ID of the series
   * @param calendarId - The ID of the calendar (required for route)
   * @returns Promise<EventSeries> The series
   */
  async getSeries(seriesId: string, calendarId: string): Promise<EventSeries> {
    const encodedSeriesId = validateAndEncodeId(seriesId, 'Series ID');
    const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');

    try {
      const response = await axios.get(`/api/v1/calendars/${encodedCalendarId}/series/${encodedSeriesId}`);
      return EventSeries.fromObject(response.data);
    }
    catch (error: unknown) {
      console.error('Error fetching series:', error);
      handleApiError(error, errorMap);
    }
  }

  /**
   * Delete a series.
   *
   * @param seriesId - The ID of the series to delete
   * @param calendarId - The ID of the calendar (required for route)
   * @returns Promise<void>
   */
  async deleteSeries(seriesId: string, calendarId: string): Promise<void> {
    const encodedSeriesId = validateAndEncodeId(seriesId, 'Series ID');
    const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');

    try {
      await axios.delete(`/api/v1/calendars/${encodedCalendarId}/series/${encodedSeriesId}`);
      this.store.removeSeries(calendarId, seriesId);
    }
    catch (error: unknown) {
      console.error('Error deleting series:', error);
      handleApiError(error, errorMap);
    }
  }

  /**
   * Assign an event to a series.
   *
   * @param eventId - The ID of the event
   * @param seriesId - The ID of the series
   * @returns Promise<void>
   */
  async assignSeries(eventId: string, seriesId: string): Promise<void> {
    const encodedEventId = validateAndEncodeId(eventId, 'Event ID');
    const encodedSeriesId = validateAndEncodeId(seriesId, 'Series ID');

    try {
      await axios.post(`/api/v1/events/${encodedEventId}/series/${encodedSeriesId}`);
    }
    catch (error: unknown) {
      console.error('Error assigning series to event:', error);
      handleApiError(error, errorMap);
    }
  }

  /**
   * Clear the series assignment from an event.
   *
   * @param eventId - The ID of the event
   * @param seriesId - The ID of the series currently assigned (required for route)
   * @returns Promise<void>
   */
  async clearSeries(eventId: string, seriesId: string): Promise<void> {
    const encodedEventId = validateAndEncodeId(eventId, 'Event ID');
    const encodedSeriesId = validateAndEncodeId(seriesId, 'Series ID');

    try {
      await axios.delete(`/api/v1/events/${encodedEventId}/series/${encodedSeriesId}`);
    }
    catch (error: unknown) {
      console.error('Error clearing series from event:', error);
      handleApiError(error, errorMap);
    }
  }

  /**
   * Get the series assigned to an event.
   *
   * @param eventId - The ID of the event
   * @returns Promise<EventSeries | null> The assigned series or null
   */
  async getEventSeries(eventId: string): Promise<EventSeries | null> {
    const encodedEventId = validateAndEncodeId(eventId, 'Event ID');

    try {
      const response = await axios.get(`/api/v1/events/${encodedEventId}/series`);
      return response.data ? EventSeries.fromObject(response.data) : null;
    }
    catch (error) {
      console.error('Error loading event series:', error);
      throw error;
    }
  }
}
