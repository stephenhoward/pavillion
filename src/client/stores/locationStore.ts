import { defineStore } from 'pinia';
import { EventLocation } from '@/common/model/location';

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
  },
});
