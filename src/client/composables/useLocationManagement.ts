import { ref } from 'vue';
import { EventLocation, EventLocationSpace } from '@/common/model/location';
import LocationService from '@/client/service/location';
import { useLocationStore } from '@/client/stores/locationStore';
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
   * When `calendarUrlName` is supplied, the composable also prefetches Spaces
   * for every Place into `locationStore.spacesByPlace` so the picker can render
   * its flat (Place + Spaces) entry list. The Spaces fetch is best-effort: a
   * failure on any single Place is logged and skipped so the picker still
   * opens with whatever Spaces were successfully cached.
   *
   * @param calendarId - The calendar ID to fetch locations for
   * @param calendarUrlName - The calendar's URL name (required to prefetch Spaces)
   */
  const openLocationPicker = async (
    calendarId: string,
    calendarUrlName?: string,
  ): Promise<void> => {
    // Fetch latest locations before showing picker
    await fetchLocations(calendarId);

    // Prefetch Spaces for every Place so the picker can render its flat list.
    // Skipped silently when the URL name isn't available — the picker still
    // works (it just shows Places without their Spaces).
    if (calendarUrlName) {
      const store = useLocationStore();
      await Promise.all(
        availableLocations.value.map(async (place) => {
          try {
            await store.fetchSpaces(calendarUrlName, place.id);
          }
          catch (error) {
            console.error(`Error fetching spaces for place ${place.id}:`, error);
          }
        }),
      );
    }

    showLocationPicker.value = true;
  };

  /**
   * Handle picker selection. The picker emits `{ placeId, spaceId | null }`
   * — `spaceId === null` means "whole venue" (NOT undefined, see DEC-008-style
   * advisor finding on null vs. undefined; the model serializes a null space
   * as `space: null` which the server interprets correctly).
   *
   * @param selection - `{ placeId, spaceId | null }` from the picker
   * @param event - The event to assign the location to
   * @param spacesByPlace - Per-Place Space cache (typically `locationStore.spacesByPlace`).
   *   Used to look up the EventLocationSpace model when `spaceId !== null`.
   */
  const selectLocation = (
    selection: { placeId: string; spaceId: string | null },
    event: CalendarEvent,
    spacesByPlace: Record<string, EventLocationSpace[]> = {},
  ): void => {
    // Resolve the Place from the available list.
    const place = availableLocations.value.find(loc => loc.id === selection.placeId);

    event.locationId = selection.placeId;
    if (place) {
      event.location = place;
    }

    // Resolve Space (or null for whole-venue selection).
    if (selection.spaceId === null) {
      event.space = null;
    }
    else {
      const spaces = spacesByPlace[selection.placeId] ?? [];
      const space = spaces.find(s => s.id === selection.spaceId) ?? null;
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
