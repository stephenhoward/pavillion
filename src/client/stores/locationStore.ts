import { defineStore } from 'pinia';
import { EventLocation } from '@/common/model/location';
import LocationService from '@/client/service/location';

export const useLocationStore = defineStore('locations', {
  state: () => {
    return {
      locations: {} as Record<string, EventLocation[]>,
    };
  },
  actions: {
    /**
     * Adds a new location to the store for the given calendar.
     *
     * @param {string} calendarId - The ID of the calendar to which the location belongs
     * @param {EventLocation} location - The location to add to the store
     */
    addLocation(calendarId: string, location: EventLocation) {
      if (!this.locations[calendarId]) {
        this.locations[calendarId] = [];
      }
      this.locations[calendarId].push(location);
    },

    /**
     * Updates an existing location in the store or adds it if not found.
     *
     * The incoming `EventLocation` carries its nested `spaces[]` snapshot inline
     * (pv-0pht atomic Place + Spaces wire contract); replacing the cached entry
     * wholesale keeps `clientId` echoes and `eventCount` values from the server
     * response visible to subscribers.
     *
     * @param {string} calendarId - The ID of the calendar to which the location belongs
     * @param {EventLocation} location - The location to update or add
     */
    updateLocation(calendarId: string, location: EventLocation) {
      if (!this.locations[calendarId]) {
        this.locations[calendarId] = [];
      }
      const index = this.locations[calendarId].findIndex((l: EventLocation) => l.id === location.id);
      if (index >= 0) {
        this.locations[calendarId][index] = location;
      }
      else {
        this.addLocation(calendarId, location);
      }
    },

    /**
     * Set locations in the store for a specific calendar, replacing any existing entries.
     *
     * @param {string} calendarId - The ID of the calendar to which the locations belong
     * @param {EventLocation[]} locations - The locations to set in the store
     */
    setLocationsForCalendar(calendarId: string, locations: EventLocation[]) {
      this.locations[calendarId] = locations;
    },

    /**
     * Remove a location from the store.
     *
     * @param {string} calendarId - The ID of the calendar to which the location belongs
     * @param {string} locationId - The ID of the location to remove
     */
    removeLocation(calendarId: string, locationId: string) {
      if (this.locations[calendarId]) {
        this.locations[calendarId] = this.locations[calendarId].filter(
          (l: EventLocation) => l.id !== locationId,
        );
      }
    },

    /**
     * Bulk-reassign every Event row attached to `(placeId, fromSpaceId)` onto
     * `toSpaceId`. Delegates to `LocationService.reassignEvents`. Errors are
     * propagated unchanged so callers (the editor's save orchestrator) can
     * collect per-reassign failures into a one-time partial-failure notice
     * without retaining state for retry (pv-0pht atomic save model).
     *
     * @param calendarId - The ID of the calendar that owns the Place
     * @param placeId - The ID of the parent Place (EventLocation)
     * @param fromSpaceId - The Space whose events are being moved
     * @param toSpaceId - The destination Space (must be on the same Place)
     * @returns The number of event rows updated
     */
    async reassignEvents(
      calendarId: string,
      placeId: string,
      fromSpaceId: string,
      toSpaceId: string,
    ): Promise<{ count: number }> {
      const service = new LocationService(this);
      return service.reassignEvents(calendarId, placeId, fromSpaceId, toSpaceId);
    },
  },
});
