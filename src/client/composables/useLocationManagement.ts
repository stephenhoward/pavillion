import { ref } from 'vue';
import { EventLocation } from '@/common/model/location';
import LocationService from '@/client/service/location';
import { CalendarEvent } from '@/common/model/events';
import { ValidationError } from '@/common/exceptions';

/**
 * Composable for managing event location selection and creation.
 * Handles location fetching, picker modal state, location selection,
 * location creation, and navigation between picker and create form.
 *
 * @returns Location management state and methods
 */
export function useLocationManagement() {
  const locationService = new LocationService();

  const availableLocations = ref<EventLocation[]>([]);
  const showLocationPicker = ref(false);
  const showCreateLocationForm = ref(false);
  const locationFieldErrors = ref<Record<string, string>>({});
  const locationSubmissionError = ref('');

  const clearLocationErrors = (): void => {
    locationFieldErrors.value = {};
    locationSubmissionError.value = '';
  };

  /**
   * Fetch all locations for a specific calendar
   *
   * @param calendarId - The calendar ID to fetch locations for
   */
  const fetchLocations = async (calendarId: string): Promise<void> => {
    if (!calendarId) return;

    try {
      availableLocations.value = await locationService.getLocations(calendarId);
    }
    catch (error) {
      console.error('Error fetching locations:', error);
      availableLocations.value = [];
    }
  };

  /**
   * Open the location picker modal and fetch latest locations
   *
   * @param calendarId - The calendar ID to fetch locations for
   */
  const openLocationPicker = async (calendarId: string): Promise<void> => {
    // Fetch latest locations before showing picker
    await fetchLocations(calendarId);
    showLocationPicker.value = true;
  };

  /**
   * Handle location selection from the picker
   *
   * @param location - The selected location
   * @param event - The event to assign the location to
   */
  const selectLocation = (location: EventLocation, event: CalendarEvent): void => {
    // Set the locationId on the event
    event.locationId = location.id;

    // Also set the location object for display purposes
    event.location = location;

    // Close the picker
    showLocationPicker.value = false;
  };

  /**
   * Navigate from location picker to create location form
   */
  const createNewLocation = (): void => {
    // Close picker and open create form
    showLocationPicker.value = false;
    showCreateLocationForm.value = true;
  };

  /**
   * Create a new location and assign it to the event
   *
   * @param calendarId - The calendar ID to create the location for
   * @param locationData - The location data to create (plain object from form)
   * @param event - The event to assign the new location to
   * @throws Error if location creation fails
   */
  const createLocation = async (
    calendarId: string,
    locationData: Record<string, any>,
    event: CalendarEvent,
  ): Promise<void> => {
    clearLocationErrors();

    // Convert raw form data to an EventLocation instance
    const location = EventLocation.fromObject(locationData);

    try {
      // Create the location via API
      const newLocation = await locationService.createLocation(calendarId, location);

      // Add to available locations
      availableLocations.value.push(newLocation);

      // Auto-select the newly created location
      event.locationId = newLocation.id;
      event.location = newLocation;

      // Close the create form
      showCreateLocationForm.value = false;
    }
    catch (error: unknown) {
      if (error instanceof ValidationError) {
        if (error.fields) {
          const flattened: Record<string, string> = {};
          for (const [field, messages] of Object.entries(error.fields)) {
            if (messages.length > 0) flattened[field] = messages[0];
          }
          locationFieldErrors.value = flattened;
        }
        locationSubmissionError.value = error.message;
      }
      throw error;
    }
  };

  /**
   * Remove the location from an event
   *
   * @param event - The event to remove the location from
   */
  const removeLocation = (event: CalendarEvent): void => {
    // Clear the location reference
    event.locationId = null;
    event.location = new EventLocation();

    // Close the picker
    showLocationPicker.value = false;
  };

  /**
   * Navigate back from create location form to location picker
   */
  const backToSearch = (): void => {
    showCreateLocationForm.value = false;
    showLocationPicker.value = true;
  };

  return {
    availableLocations,
    showLocationPicker,
    showCreateLocationForm,
    locationFieldErrors,
    locationSubmissionError,
    fetchLocations,
    openLocationPicker,
    selectLocation,
    createNewLocation,
    createLocation,
    clearLocationErrors,
    removeLocation,
    backToSearch,
  };
}
