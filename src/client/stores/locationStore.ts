import { defineStore } from 'pinia';
import { EventLocation, EventLocationSpace } from '@/common/model/location';
import LocationService, { type SpaceContentByLang } from '@/client/service/location';

export const useLocationStore = defineStore('locations', {
  state: () => {
    return {
      locations: {} as Record<string, EventLocation[]>,
      // Spaces cached per parent Place ID. Populated by fetchSpaces and
      // replaced wholesale after each Space CRUD operation so the cache
      // never drifts from server state (e.g. server-added defaults).
      spacesByPlace: {} as Record<string, EventLocationSpace[]>,
    };
  },
  getters: {
    /**
     * Reactive accessor for the Spaces cached under a given Place.
     *
     * Returns an empty array when no fetch has populated the cache yet.
     * Naming follows the project's `get<Resource>By<Field>` getter convention
     * (see `getCalendarById` in calendarStore).
     *
     * @param state - Pinia state (injected)
     * @returns A function that takes a placeId and returns the cached Spaces
     */
    getSpacesForPlace: (state) => (placeId: string): EventLocationSpace[] => {
      return state.spacesByPlace[placeId] ?? [];
    },
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

    // ─────────────────────────────────────────────────────────────────
    // Spaces (sub-areas of a Place)
    // ─────────────────────────────────────────────────────────────────

    /**
     * Replace the Spaces cached under a Place.
     *
     * Low-level mutator. Most callers should use `fetchSpaces` (or one of
     * the CRUD wrappers) instead of writing the cache directly.
     *
     * @param placeId - The ID of the parent Place (EventLocation)
     * @param spaces - The Spaces to cache for this Place
     */
    setSpacesForPlace(placeId: string, spaces: EventLocationSpace[]) {
      this.spacesByPlace[placeId] = spaces;
    },

    /**
     * Fetch all Spaces for a Place from the server and cache them in the store.
     *
     * @param calendarUrlName - The URL name of the calendar
     * @param placeId - The ID of the parent Place (EventLocation)
     * @returns The list of Spaces fetched from the server
     */
    async fetchSpaces(calendarUrlName: string, placeId: string): Promise<EventLocationSpace[]> {
      const service = new LocationService(this);
      const spaces = await service.getSpaces(calendarUrlName, placeId);
      this.setSpacesForPlace(placeId, spaces);
      return spaces;
    },

    /**
     * Create a new Space under a Place, then refetch the Place's Spaces so the
     * cache reflects any server-side defaults.
     *
     * @param calendarUrlName - The URL name of the calendar
     * @param placeId - The ID of the parent Place (EventLocation)
     * @param contentByLang - Per-language `{ name, accessibilityInfo }` content map
     * @returns The created Space (as returned by the service)
     */
    async createSpace(
      calendarUrlName: string,
      placeId: string,
      contentByLang: SpaceContentByLang,
    ): Promise<EventLocationSpace> {
      const service = new LocationService(this);
      const created = await service.createSpace(calendarUrlName, placeId, contentByLang);
      await this.fetchSpaces(calendarUrlName, placeId);
      return created;
    },

    /**
     * Update an existing Space's multilingual content, then refetch the parent
     * Place's Spaces so the cache reflects the latest server state.
     *
     * @param calendarUrlName - The URL name of the calendar
     * @param placeId - The ID of the parent Place (EventLocation) — used to scope the refetch
     * @param spaceId - The ID of the Space to update
     * @param contentByLang - Per-language `{ name, accessibilityInfo }` content map
     * @returns The updated Space (as returned by the service)
     */
    async updateSpace(
      calendarUrlName: string,
      placeId: string,
      spaceId: string,
      contentByLang: SpaceContentByLang,
    ): Promise<EventLocationSpace> {
      const service = new LocationService(this);
      const updated = await service.updateSpace(calendarUrlName, spaceId, contentByLang);
      await this.fetchSpaces(calendarUrlName, placeId);
      return updated;
    },

    /**
     * Delete a Space, then refetch the parent Place's Spaces so the cache
     * reflects the removal.
     *
     * @param calendarUrlName - The URL name of the calendar
     * @param placeId - The ID of the parent Place (EventLocation) — used to scope the refetch
     * @param spaceId - The ID of the Space to delete
     */
    async deleteSpace(
      calendarUrlName: string,
      placeId: string,
      spaceId: string,
    ): Promise<void> {
      const service = new LocationService(this);
      await service.deleteSpace(calendarUrlName, spaceId);
      await this.fetchSpaces(calendarUrlName, placeId);
    },
  },
});
