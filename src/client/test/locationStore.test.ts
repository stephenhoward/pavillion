import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useLocationStore } from '@/client/stores/locationStore';
import { EventLocation } from '@/common/model/location';

describe('LocationStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('addLocation', () => {
    it('should add a location to the store', () => {
      const store = useLocationStore();
      const location = new EventLocation('location-1', 'Community Center');

      store.addLocation('calendar-123', location);

      expect(store.locations['calendar-123']).toHaveLength(1);
      expect(store.locations['calendar-123'][0]).toStrictEqual(location);
    });

    it('should create calendar array if it does not exist', () => {
      const store = useLocationStore();
      const location = new EventLocation('location-1', 'Community Center');

      store.addLocation('new-calendar', location);

      expect(store.locations['new-calendar']).toBeDefined();
      expect(store.locations['new-calendar']).toHaveLength(1);
    });
  });

  describe('updateLocation', () => {
    it('should update an existing location', () => {
      const store = useLocationStore();
      const originalLocation = new EventLocation('location-1', 'Community Center', '123 Main St');

      store.addLocation('calendar-123', originalLocation);

      const updatedLocation = new EventLocation('location-1', 'Updated Center', '456 Oak Ave');

      store.updateLocation('calendar-123', updatedLocation);

      expect(store.locations['calendar-123']).toHaveLength(1);
      expect(store.locations['calendar-123'][0]).toStrictEqual(updatedLocation);
      expect(store.locations['calendar-123'][0].name).toBe('Updated Center');
    });

    it('should add location if it does not exist', () => {
      const store = useLocationStore();
      const location = new EventLocation('location-1', 'New Venue');

      store.updateLocation('calendar-123', location);

      expect(store.locations['calendar-123']).toHaveLength(1);
      expect(store.locations['calendar-123'][0]).toStrictEqual(location);
    });
  });

  describe('setLocationsForCalendar', () => {
    it('should set locations for a calendar', () => {
      const store = useLocationStore();
      const location1 = new EventLocation('location-1', 'Venue A');
      const location2 = new EventLocation('location-2', 'Venue B');
      const locations = [location1, location2];

      store.setLocationsForCalendar('calendar-123', locations);

      expect(store.locations['calendar-123']).toHaveLength(2);
      expect(store.locations['calendar-123']).toStrictEqual(locations);
    });

    it('should replace existing locations', () => {
      const store = useLocationStore();
      const oldLocation = new EventLocation('old-location', 'Old Venue');
      store.addLocation('calendar-123', oldLocation);

      const newLocations = [
        new EventLocation('location-1', 'Venue A'),
        new EventLocation('location-2', 'Venue B'),
      ];

      store.setLocationsForCalendar('calendar-123', newLocations);

      expect(store.locations['calendar-123']).toHaveLength(2);
      expect(store.locations['calendar-123']).toStrictEqual(newLocations);
      expect(store.locations['calendar-123']).not.toContain(oldLocation);
    });
  });

  describe('removeLocation', () => {
    it('should remove a location by ID', () => {
      const store = useLocationStore();
      const location1 = new EventLocation('location-1', 'Venue A');
      const location2 = new EventLocation('location-2', 'Venue B');

      store.addLocation('calendar-123', location1);
      store.addLocation('calendar-123', location2);

      expect(store.locations['calendar-123']).toHaveLength(2);

      store.removeLocation('calendar-123', 'location-1');

      expect(store.locations['calendar-123']).toHaveLength(1);
      expect(store.locations['calendar-123'][0]).toStrictEqual(location2);
    });

    it('should handle removing from non-existent calendar', () => {
      const store = useLocationStore();

      // Should not throw error
      store.removeLocation('non-existent-calendar', 'location-1');

      expect(store.locations['non-existent-calendar']).toBeUndefined();
    });

    it('should handle removing non-existent location', () => {
      const store = useLocationStore();
      const location = new EventLocation('location-1', 'Venue A');
      store.addLocation('calendar-123', location);

      store.removeLocation('calendar-123', 'non-existent-location');

      expect(store.locations['calendar-123']).toHaveLength(1);
      expect(store.locations['calendar-123'][0]).toStrictEqual(location);
    });
  });
});
