import axios from 'axios';
import { EventLocation, EventLocationSpace } from '@/common/model/location';
import { CalendarNotFoundError, InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';
import { UnauthenticatedError, UnknownError, ValidationError } from '@/common/exceptions';
import { useLocationStore } from '@/client/stores/locationStore';
import ModelService from '@/client/service/models';
import { validateAndEncodeId, handleApiError } from '@/client/service/utils';

const errorMap = {
  CalendarNotFoundError,
  InsufficientCalendarPermissionsError,
  UnauthenticatedError,
  UnknownError,
  ValidationError,
};

/**
 * Per-language content payload shape accepted by the Space create/update endpoints.
 * Mirrors the server-side `extractContentByLang` shape in SpaceRoutes.
 */
export type SpaceContentByLang = Record<string, { name: string; accessibilityInfo: string }>;

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
   * Get all locations for a specific calendar
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
   * Create a new location for a calendar
   *
   * @param calendarId - The ID of the calendar
   * @param location - The location to create
   * @returns Promise<EventLocation> The created location
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
   * Update an existing location for a calendar
   *
   * @param calendarId - The ID of the calendar
   * @param location - The location to update
   * @returns Promise<EventLocation> The updated location
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
   * Get all Spaces for a Place within a calendar.
   *
   * HTTP-layer only — does not touch the locationStore. Store integration is
   * added by the locationStore Space accessors task (pv-ix7v.4.3).
   *
   * @param calendarUrlName - The URL name of the calendar
   * @param placeId - The ID of the parent Place (EventLocation)
   * @returns Promise<EventLocationSpace[]> The list of Spaces under the Place
   */
  async getSpaces(calendarUrlName: string, placeId: string): Promise<EventLocationSpace[]> {
    const encodedCalendarUrlName = validateAndEncodeId(calendarUrlName, 'Calendar URL name');
    const encodedPlaceId = validateAndEncodeId(placeId, 'Place ID');

    try {
      const response = await axios.get(
        `/api/v1/calendars/${encodedCalendarUrlName}/places/${encodedPlaceId}/spaces`,
      );
      return response.data.map((spaceData: any) => EventLocationSpace.fromObject(spaceData));
    }
    catch (error) {
      console.error('Error loading spaces:', error);
      throw error;
    }
  }

  /**
   * Create a new Space under a Place within a calendar.
   *
   * HTTP-layer only — does not touch the locationStore. Store integration is
   * added by the locationStore Space accessors task (pv-ix7v.4.3).
   *
   * @param calendarUrlName - The URL name of the calendar
   * @param placeId - The ID of the parent Place (EventLocation)
   * @param contentByLang - Per-language `{ name, accessibilityInfo }` content map
   * @returns Promise<EventLocationSpace> The created Space
   */
  async createSpace(
    calendarUrlName: string,
    placeId: string,
    contentByLang: SpaceContentByLang,
  ): Promise<EventLocationSpace> {
    const encodedCalendarUrlName = validateAndEncodeId(calendarUrlName, 'Calendar URL name');
    const encodedPlaceId = validateAndEncodeId(placeId, 'Place ID');

    try {
      const response = await axios.post(
        `/api/v1/calendars/${encodedCalendarUrlName}/places/${encodedPlaceId}/spaces`,
        { content: contentByLang },
      );
      return EventLocationSpace.fromObject(response.data);
    }
    catch (error: unknown) {
      console.error('Error creating space:', error);
      handleApiError(error, errorMap);
    }
  }

  /**
   * Update an existing Space's multilingual content (full replacement).
   *
   * HTTP-layer only — does not touch the locationStore. Store integration is
   * added by the locationStore Space accessors task (pv-ix7v.4.3).
   *
   * @param calendarUrlName - The URL name of the calendar
   * @param spaceId - The ID of the Space to update
   * @param contentByLang - Per-language `{ name, accessibilityInfo }` content map
   * @returns Promise<EventLocationSpace> The updated Space
   */
  async updateSpace(
    calendarUrlName: string,
    spaceId: string,
    contentByLang: SpaceContentByLang,
  ): Promise<EventLocationSpace> {
    const encodedCalendarUrlName = validateAndEncodeId(calendarUrlName, 'Calendar URL name');
    const encodedSpaceId = validateAndEncodeId(spaceId, 'Space ID');

    try {
      const response = await axios.put(
        `/api/v1/calendars/${encodedCalendarUrlName}/spaces/${encodedSpaceId}`,
        { content: contentByLang },
      );
      return EventLocationSpace.fromObject(response.data);
    }
    catch (error: unknown) {
      console.error('Error updating space:', error);
      handleApiError(error, errorMap);
    }
  }

  /**
   * Delete a Space from a calendar.
   *
   * HTTP-layer only — does not touch the locationStore. Store integration is
   * added by the locationStore Space accessors task (pv-ix7v.4.3).
   *
   * @param calendarUrlName - The URL name of the calendar
   * @param spaceId - The ID of the Space to delete
   */
  async deleteSpace(calendarUrlName: string, spaceId: string): Promise<void> {
    const encodedCalendarUrlName = validateAndEncodeId(calendarUrlName, 'Calendar URL name');
    const encodedSpaceId = validateAndEncodeId(spaceId, 'Space ID');

    try {
      await axios.delete(`/api/v1/calendars/${encodedCalendarUrlName}/spaces/${encodedSpaceId}`);
    }
    catch (error: unknown) {
      console.error('Error deleting space:', error);
      handleApiError(error, errorMap);
    }
  }
}
