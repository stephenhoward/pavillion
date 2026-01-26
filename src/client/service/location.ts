import axios from 'axios';
import { EventLocation } from '@/common/model/location';
import { validateAndEncodeId } from '@/client/service/utils';

/**
 * Service for managing event locations
 */
export default class LocationService {
  /**
   * Get all locations for a specific calendar
   * @param calendarId - The ID of the calendar
   * @returns Promise<EventLocation[]> The list of locations
   */
  async getLocations(calendarId: string): Promise<EventLocation[]> {
    const encodedId = validateAndEncodeId(calendarId, 'Calendar ID');

    try {
      const response = await axios.get(`/api/v1/calendars/${encodedId}/locations`);
      return response.data.map((locationData: any) => EventLocation.fromObject(locationData));
    }
    catch (error) {
      console.error('Error loading locations:', error);
      throw error;
    }
  }

  /**
   * Create a new location for a calendar
   * @param calendarId - The ID of the calendar
   * @param locationData - The location data to create
   * @returns Promise<EventLocation> The created location
   */
  async createLocation(calendarId: string, locationData: any): Promise<EventLocation> {
    const encodedId = validateAndEncodeId(calendarId, 'Calendar ID');

    try {
      const response = await axios.post(`/api/v1/calendars/${encodedId}/locations`, locationData);
      return EventLocation.fromObject(response.data);
    }
    catch (error) {
      console.error('Error creating location:', error);
      throw error;
    }
  }

  /**
   * Get a specific location by ID
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
}
