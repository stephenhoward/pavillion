import axios from 'axios';
import { EventLocation } from '@/common/model/location';
import {
  CalendarNotFoundError,
  InsufficientCalendarPermissionsError,
  LocationNotFoundError,
} from '@/common/exceptions/calendar';
import { UnauthenticatedError, UnknownError, ValidationError } from '@/common/exceptions';
import { useLocationStore } from '@/client/stores/locationStore';
import ModelService from '@/client/service/models';
import { validateAndEncodeId, handleApiError } from '@/client/service/utils';

const errorMap = {
  CalendarNotFoundError,
  InsufficientCalendarPermissionsError,
  LocationNotFoundError,
  UnauthenticatedError,
  UnknownError,
  ValidationError,
};

/**
 * Service for managing event locations
 */
export default class LocationService {
  store: ReturnType<typeof useLocationStore>;

  /**
   * Constructor that accepts a location store instance.
   *
   * @param store The location store to use (defaults to useLocationStore())
   */
  constructor(store: ReturnType<typeof useLocationStore> = useLocationStore()) {
    this.store = store;
  }

  /**
   * Get all locations for a specific calendar.
   *
   * Locations ride with their nested `spaces[]` snapshot inline (atomic
   * Place + Spaces wire contract). `EventLocation.fromObject` populates
   * `spaces[]` from the response payload.
   *
   * @param calendarId - The ID of the calendar
   * @returns Promise<EventLocation[]> The list of locations
   */
  async getLocations(calendarId: string): Promise<EventLocation[]> {
    const encodedId = validateAndEncodeId(calendarId, 'Calendar ID');

    try {
      const response = await axios.get(`/api/v1/calendars/${encodedId}/locations`);
      const locations = response.data.map((locationData: any) => EventLocation.fromObject(locationData));
      this.store.setLocationsForCalendar(calendarId, locations);
      return locations;
    }
    catch (error) {
      console.error('Error loading locations:', error);
      throw error;
    }
  }

  /**
   * Create a new location for a calendar.
   *
   * Sends `EventLocation.toObject()` (which now includes `spaces[]`) so a Place
   * can be created together with its initial Spaces in a single transaction.
   * The response carries the persisted Place plus `spaces[]` with `clientId`
   * echoes for any newly-created Space rows so the client can correlate
   * staged-anchor → server-assigned id.
   *
   * @param calendarId - The ID of the calendar
   * @param location - The location to create (with optional `spaces[]` snapshot)
   * @returns Promise<EventLocation> The created location with persisted spaces
   */
  async createLocation(calendarId: string, location: EventLocation): Promise<EventLocation> {
    const encodedId = validateAndEncodeId(calendarId, 'Calendar ID');

    try {
      const url = `/api/v1/calendars/${encodedId}/locations`;
      const responseData = await ModelService.createModel(location, url);
      const savedLocation = EventLocation.fromObject(responseData);
      this.store.addLocation(calendarId, savedLocation);
      return savedLocation;
    }
    catch (error: unknown) {
      console.error('Error creating location:', error);
      handleApiError(error, errorMap);
    }
  }

  /**
   * Get a specific location by ID
   *
   * @param calendarId - The ID of the calendar
   * @param locationId - The ID of the location
   * @returns Promise<EventLocation> The location
   */
  async getLocationById(calendarId: string, locationId: string): Promise<EventLocation> {
    const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');
    const encodedLocationId = validateAndEncodeId(locationId, 'Location ID');

    try {
      const response = await axios.get(`/api/v1/calendars/${encodedCalendarId}/locations/${encodedLocationId}`);
      return EventLocation.fromObject(response.data);
    }
    catch (error) {
      console.error('Error loading location:', error);
      throw error;
    }
  }

  /**
   * Update an existing location for a calendar.
   *
   * Sends `EventLocation.toObject()` (snapshot semantics: the nested `spaces[]`
   * array represents the full intended-after state — missing rows are deleted
   * server-side, new rows carry a `clientId` for correlation, existing rows
   * carry their `id`). Response parses through `EventLocation.fromObject` so
   * `clientId` echoes on newly-created Space rows are preserved for the
   * client to map back to its staged-anchor entries.
   *
   * @param calendarId - The ID of the calendar
   * @param location - The location to update (with full `spaces[]` snapshot)
   * @returns Promise<EventLocation> The updated location with persisted spaces
   */
  async updateLocation(calendarId: string, location: EventLocation): Promise<EventLocation> {
    const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');

    try {
      const url = `/api/v1/calendars/${encodedCalendarId}/locations`;
      const responseData = await ModelService.updateModel(location, url);
      const savedLocation = EventLocation.fromObject(responseData);
      this.store.updateLocation(calendarId, savedLocation);
      return savedLocation;
    }
    catch (error: unknown) {
      console.error('Error updating location:', error);
      handleApiError(error, errorMap);
    }
  }

  /**
   * Delete a location from a calendar
   *
   * @param calendarId - The ID of the calendar
   * @param locationId - The ID of the location to delete
   */
  async deleteLocation(calendarId: string, locationId: string): Promise<void> {
    const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');
    const encodedLocationId = validateAndEncodeId(locationId, 'Location ID');

    try {
      await axios.delete(`/api/v1/calendars/${encodedCalendarId}/locations/${encodedLocationId}`);
      this.store.removeLocation(calendarId, locationId);
    }
    catch (error: unknown) {
      console.error('Error deleting location:', error);
      handleApiError(error, errorMap);
    }
  }

  /**
   * Bulk-reassign every Event row attached to `(placeId, fromSpaceId)` onto
   * `toSpaceId`. Action-path bulk operation (see `bulk-assign-categories`
   * precedent). Fired by the editor's save orchestrator after the parent
   * Place save returns; whole-venue moves are NOT reassigned through here
   * (the FK `ON DELETE SET NULL` on `events.space_id` handles those when a
   * Space is dropped from the snapshot).
   *
   * @param calendarId - The ID of the calendar that owns the Place
   * @param placeId - The ID of the parent Place (EventLocation)
   * @param fromSpaceId - The Space whose events are being moved
   * @param toSpaceId - The destination Space (must be on the same Place)
   * @returns Promise<{ count: number }> The number of event rows updated
   */
  async reassignEvents(
    calendarId: string,
    placeId: string,
    fromSpaceId: string,
    toSpaceId: string,
  ): Promise<{ count: number }> {
    const encodedCalendarId = validateAndEncodeId(calendarId, 'Calendar ID');
    const encodedPlaceId = validateAndEncodeId(placeId, 'Place ID');

    try {
      const response = await axios.post(
        `/api/v1/calendars/${encodedCalendarId}/locations/${encodedPlaceId}/reassign-events`,
        { fromSpaceId, toSpaceId },
      );
      return { count: response.data.count };
    }
    catch (error: unknown) {
      console.error('Error reassigning events:', error);
      handleApiError(error, errorMap);
    }
  }
}
