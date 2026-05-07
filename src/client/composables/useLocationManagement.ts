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
   * Open the location picker modal and fetch latest locations.
   *
   * Spaces ride along inline on each Place via `place.spaces[]` (pv-0pht
   * atomic Place + Spaces wire contract — eager-loaded server-side), so no
   * separate per-Place Spaces prefetch is needed. The picker reads
   * `place.spaces` inline.
   *
   * @param calendarId - The calendar ID to fetch locations for
   */
  const openLocationPicker = async (calendarId: string): Promise<void> => {
    // Fetch latest locations before showing picker. Each EventLocation in the
    // response carries its `spaces[]` inline.
    await fetchLocations(calendarId);

    showLocationPicker.value = true;
  };

  /**
   * Handle picker selection. The picker emits `{ placeId, spaceId | null }`
   * — `spaceId === null` means "whole venue" (NOT undefined; the model
   * serializes a null space as `space: null` which the server interprets
   * correctly).
   *
   * Space lookup reads `place.spaces` inline on the resolved Place — no
   * separate Spaces cache (pv-0pht atomic Place + Spaces wire contract).
   *
   * @param selection - `{ placeId, spaceId | null }` from the picker
   * @param event - The event to assign the location to
   */
  const selectLocation = (
    selection: { placeId: string; spaceId: string | null },
    event: CalendarEvent,
  ): void => {
    // Resolve the Place from the available list.
    const place = availableLocations.value.find(loc => loc.id === selection.placeId);

    event.locationId = selection.placeId;
    if (place) {
      event.location = place;
    }

    // Resolve Space (or null for whole-venue selection) from the Place's
    // inline `spaces[]`. Falls back to null if the Place couldn't be resolved
    // or the spaceId isn't present on it (e.g. stale picker payload).
    if (selection.spaceId === null) {
      event.space = null;
    }
    else {
      const space = place?.spaces.find(s => s.id === selection.spaceId) ?? null;
      event.space = space;
    }

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
      // Newly-created Place has no Spaces yet — clear any stale space.
      event.space = null;

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
    // Removing the Place implies removing any selected Space.
    event.space = null;

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
