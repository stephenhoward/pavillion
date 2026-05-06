import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import sinon from 'sinon';
import { useLocationStore } from '@/client/stores/locationStore';
import { EventLocation, EventLocationSpace } from '@/common/model/location';
import LocationService from '@/client/service/location';

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

  // ─────────────────────────────────────────────────────────────────────
  // Spaces (sub-areas of a Place)
  // ─────────────────────────────────────────────────────────────────────

  describe('Spaces', () => {
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
    });

    afterEach(() => {
      sandbox.restore();
    });

    /** Build an EventLocationSpace with a single English content entry. */
    function makeSpace(id: string, placeId: string, name: string): EventLocationSpace {
      return EventLocationSpace.fromObject({
        id,
        placeId,
        content: {
          en: { name, accessibilityInfo: '' },
        },
      });
    }

    describe('getSpacesForPlace', () => {
      it('should return an empty array for an unknown place', () => {
        const store = useLocationStore();

        expect(store.getSpacesForPlace('place-unknown')).toStrictEqual([]);
      });

      it('should return the cached spaces for a place after fetch', async () => {
        const store = useLocationStore();
        const space1 = makeSpace('space-1', 'place-1', 'Main Hall');
        const space2 = makeSpace('space-2', 'place-1', 'Side Room');

        sandbox.stub(LocationService.prototype, 'getSpaces').resolves([space1, space2]);

        await store.fetchSpaces('cal-url', 'place-1');

        const result = store.getSpacesForPlace('place-1');
        expect(result).toHaveLength(2);
        expect(result[0].id).toBe('space-1');
        expect(result[1].id).toBe('space-2');
      });

      it('should not leak spaces between places', async () => {
        const store = useLocationStore();
        const spaceForPlace1 = makeSpace('space-1', 'place-1', 'Main Hall');

        sandbox.stub(LocationService.prototype, 'getSpaces').resolves([spaceForPlace1]);

        await store.fetchSpaces('cal-url', 'place-1');

        expect(store.getSpacesForPlace('place-1')).toHaveLength(1);
        expect(store.getSpacesForPlace('place-2')).toStrictEqual([]);
      });
    });

    describe('setSpacesForPlace', () => {
      it('should set the spaces for a place, replacing any existing entries', () => {
        const store = useLocationStore();
        const oldSpace = makeSpace('old-space', 'place-1', 'Old Room');
        const newSpaces = [
          makeSpace('space-1', 'place-1', 'Main Hall'),
          makeSpace('space-2', 'place-1', 'Side Room'),
        ];

        store.setSpacesForPlace('place-1', [oldSpace]);
        store.setSpacesForPlace('place-1', newSpaces);

        expect(store.getSpacesForPlace('place-1')).toStrictEqual(newSpaces);
        expect(store.getSpacesForPlace('place-1')).not.toContain(oldSpace);
      });
    });

    describe('fetchSpaces', () => {
      it('should call the service and populate the store', async () => {
        const store = useLocationStore();
        const space = makeSpace('space-1', 'place-1', 'Main Hall');
        const getSpacesStub = sandbox.stub(LocationService.prototype, 'getSpaces').resolves([space]);

        const result = await store.fetchSpaces('cal-url', 'place-1');

        expect(getSpacesStub.calledOnceWithExactly('cal-url', 'place-1')).toBe(true);
        expect(result).toStrictEqual([space]);
        expect(store.getSpacesForPlace('place-1')).toStrictEqual([space]);
      });

      it('should propagate service errors', async () => {
        const store = useLocationStore();
        const error = new Error('boom');
        sandbox.stub(LocationService.prototype, 'getSpaces').rejects(error);

        await expect(store.fetchSpaces('cal-url', 'place-1')).rejects.toThrow('boom');
      });
    });

    describe('createSpace', () => {
      it('should call the service then refetch spaces for the place', async () => {
        const store = useLocationStore();
        const created = makeSpace('space-new', 'place-1', 'New Room');
        const refetched = [
          makeSpace('space-existing', 'place-1', 'Existing'),
          created,
        ];

        const createStub = sandbox
          .stub(LocationService.prototype, 'createSpace')
          .resolves(created);
        const getStub = sandbox
          .stub(LocationService.prototype, 'getSpaces')
          .resolves(refetched);

        const content = { en: { name: 'New Room', accessibilityInfo: '' } };
        const result = await store.createSpace('cal-url', 'place-1', content);

        expect(createStub.calledOnceWithExactly('cal-url', 'place-1', content)).toBe(true);
        expect(getStub.calledOnceWithExactly('cal-url', 'place-1')).toBe(true);
        expect(result).toStrictEqual(created);
        expect(store.getSpacesForPlace('place-1')).toStrictEqual(refetched);
      });

      it('should not refetch if the service call fails', async () => {
        const store = useLocationStore();
        const createStub = sandbox
          .stub(LocationService.prototype, 'createSpace')
          .rejects(new Error('create failed'));
        const getStub = sandbox.stub(LocationService.prototype, 'getSpaces').resolves([]);

        const content = { en: { name: 'Fail', accessibilityInfo: '' } };

        await expect(store.createSpace('cal-url', 'place-1', content)).rejects.toThrow('create failed');
        expect(createStub.calledOnce).toBe(true);
        expect(getStub.called).toBe(false);
      });
    });

    describe('updateSpace', () => {
      it('should call the service then refetch spaces for the place', async () => {
        const store = useLocationStore();
        const updated = makeSpace('space-1', 'place-1', 'Updated Hall');
        const refetched = [updated];

        const updateStub = sandbox
          .stub(LocationService.prototype, 'updateSpace')
          .resolves(updated);
        const getStub = sandbox
          .stub(LocationService.prototype, 'getSpaces')
          .resolves(refetched);

        const content = { en: { name: 'Updated Hall', accessibilityInfo: '' } };
        const result = await store.updateSpace('cal-url', 'place-1', 'space-1', content);

        expect(updateStub.calledOnceWithExactly('cal-url', 'space-1', content)).toBe(true);
        expect(getStub.calledOnceWithExactly('cal-url', 'place-1')).toBe(true);
        expect(result).toStrictEqual(updated);
        expect(store.getSpacesForPlace('place-1')).toStrictEqual(refetched);
      });

      it('should not refetch if the service call fails', async () => {
        const store = useLocationStore();
        const updateStub = sandbox
          .stub(LocationService.prototype, 'updateSpace')
          .rejects(new Error('update failed'));
        const getStub = sandbox.stub(LocationService.prototype, 'getSpaces').resolves([]);

        const content = { en: { name: 'Fail', accessibilityInfo: '' } };

        await expect(store.updateSpace('cal-url', 'place-1', 'space-1', content))
          .rejects.toThrow('update failed');
        expect(updateStub.calledOnce).toBe(true);
        expect(getStub.called).toBe(false);
      });
    });

    describe('deleteSpace', () => {
      it('should call the service then refetch spaces for the place', async () => {
        const store = useLocationStore();
        // Seed the cache so we can confirm the refetch replaces it.
        store.setSpacesForPlace('place-1', [
          makeSpace('space-1', 'place-1', 'Main Hall'),
          makeSpace('space-2', 'place-1', 'Side Room'),
        ]);

        const refetched = [makeSpace('space-2', 'place-1', 'Side Room')];

        const deleteStub = sandbox
          .stub(LocationService.prototype, 'deleteSpace')
          .resolves();
        const getStub = sandbox
          .stub(LocationService.prototype, 'getSpaces')
          .resolves(refetched);

        await store.deleteSpace('cal-url', 'place-1', 'space-1');

        expect(deleteStub.calledOnceWithExactly('cal-url', 'space-1')).toBe(true);
        expect(getStub.calledOnceWithExactly('cal-url', 'place-1')).toBe(true);
        expect(store.getSpacesForPlace('place-1')).toStrictEqual(refetched);
      });

      it('should not refetch if the service call fails', async () => {
        const store = useLocationStore();
        const deleteStub = sandbox
          .stub(LocationService.prototype, 'deleteSpace')
          .rejects(new Error('delete failed'));
        const getStub = sandbox.stub(LocationService.prototype, 'getSpaces').resolves([]);

        await expect(store.deleteSpace('cal-url', 'place-1', 'space-1'))
          .rejects.toThrow('delete failed');
        expect(deleteStub.calledOnce).toBe(true);
        expect(getStub.called).toBe(false);
      });
    });
  });
});
