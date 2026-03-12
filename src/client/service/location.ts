import axios from 'axios';
import { EventLocation } from '@/common/model/location';
import { CalendarNotFoundError, InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';
import { UnauthenticatedError, UnknownError } from '@/common/exceptions';
import { useLocationStore } from '@/client/stores/locationStore';
import ModelService from '@/client/service/models';
import { validateAndEncodeId, handleApiError } from '@/client/service/utils';

const errorMap = {
  CalendarNotFoundError,
  InsufficientCalendarPermissionsError,
  UnauthenticatedError,
  UnknownError,
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
}
