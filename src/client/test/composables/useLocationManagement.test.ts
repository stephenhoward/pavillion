import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import { useLocationManagement } from '@/client/composables/useLocationManagement';
import LocationService from '@/client/service/location';
import { EventLocation } from '@/common/model/location';
import { CalendarEvent } from '@/common/model/events';

describe('useLocationManagement', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('initialization', () => {
    it('should initialize with empty available locations', () => {
      const { availableLocations } = useLocationManagement();

      expect(availableLocations.value).toEqual([]);
    });

    it('should initialize with closed modal states', () => {
      const { showLocationPicker, showCreateLocationForm } = useLocationManagement();

      expect(showLocationPicker.value).toBe(false);
      expect(showCreateLocationForm.value).toBe(false);
    });
  });

  describe('fetchLocations', () => {
    it('should fetch locations and update availableLocations', async () => {
      const mockLocations = [
        new EventLocation('loc1', 'Venue 1', '123 Main St'),
        new EventLocation('loc2', 'Venue 2', '456 Oak Ave'),
      ];

      // Mock the composable to use our stub
      const { fetchLocations, availableLocations } = useLocationManagement();

      // Replace the service instance with our stub
      vi.spyOn(LocationService.prototype, 'getLocations').mockResolvedValue(mockLocations);

      await fetchLocations('calendar123');

      expect(availableLocations.value).toEqual(mockLocations);
    });

    it('should handle errors gracefully and set empty array', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Mock the service to reject
      vi.spyOn(LocationService.prototype, 'getLocations').mockRejectedValue(new Error('Network error'));

      const { fetchLocations, availableLocations } = useLocationManagement();

      await fetchLocations('calendar123');

      expect(availableLocations.value).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error fetching locations:', expect.any(Error));

      consoleErrorSpy.mockRestore();
    });

    it('should not fetch if calendarId is empty', async () => {
      const getLocationsSpy = vi.spyOn(LocationService.prototype, 'getLocations');

      const { fetchLocations } = useLocationManagement();

      await fetchLocations('');

      expect(getLocationsSpy).not.toHaveBeenCalled();
    });
  });

  describe('openLocationPicker', () => {
    it('should fetch locations and open the picker modal', async () => {
      const mockLocations = [
        new EventLocation('loc1', 'Venue 1'),
      ];

      vi.spyOn(LocationService.prototype, 'getLocations').mockResolvedValue(mockLocations);

      const { openLocationPicker, showLocationPicker, availableLocations } = useLocationManagement();

      await openLocationPicker('calendar123');

      expect(availableLocations.value).toEqual(mockLocations);
      expect(showLocationPicker.value).toBe(true);
    });
  });

  describe('selectLocation', () => {
    it('should assign location to event and close picker', () => {
      const { selectLocation, showLocationPicker } = useLocationManagement();

      // Open picker first
      showLocationPicker.value = true;

      const location = new EventLocation('loc1', 'Test Venue', '123 Main St');
      const event = new CalendarEvent('event1', 'calendar1');

      selectLocation(location, event);

      expect(event.locationId).toBe('loc1');
      expect(event.location).toEqual(location);
      expect(showLocationPicker.value).toBe(false);
    });
  });

  describe('createNewLocation', () => {
    it('should close picker and open create form', () => {
      const { createNewLocation, showLocationPicker, showCreateLocationForm } = useLocationManagement();

      // Start with picker open
      showLocationPicker.value = true;

      createNewLocation();

      expect(showLocationPicker.value).toBe(false);
      expect(showCreateLocationForm.value).toBe(true);
    });
  });

  describe('createLocation', () => {
    it('should create location, add to available locations, and assign to event', async () => {
      const newLocation = new EventLocation('loc3', 'New Venue', '789 Elm St');

      vi.spyOn(LocationService.prototype, 'createLocation').mockResolvedValue(newLocation);

      const { createLocation, availableLocations, showCreateLocationForm } = useLocationManagement();

      // Open create form first
      showCreateLocationForm.value = true;

      const event = new CalendarEvent('event1', 'calendar1');
      const locationData = {
        name: 'New Venue',
        address: '789 Elm St',
      };

      await createLocation('calendar1', locationData, event);

      // Check that the location was added to availableLocations
      expect(availableLocations.value).toHaveLength(1);
      expect(availableLocations.value[0].id).toBe('loc3');
      expect(availableLocations.value[0].name).toBe('New Venue');
      expect(availableLocations.value[0].address).toBe('789 Elm St');

      // Check that it was assigned to the event
      expect(event.locationId).toBe('loc3');
      expect(event.location).toEqual(newLocation);
      expect(showCreateLocationForm.value).toBe(false);
    });

    it('should handle creation errors and re-throw', async () => {
      const error = new Error('Creation failed');

      vi.spyOn(LocationService.prototype, 'createLocation').mockRejectedValue(error);

      const { createLocation } = useLocationManagement();

      const event = new CalendarEvent('event1', 'calendar1');

      await expect(
        createLocation('calendar1', { name: 'Test' }, event),
      ).rejects.toThrow('Creation failed');
    });
  });

  describe('removeLocation', () => {
    it('should clear location from event and close picker', () => {
      const { removeLocation, showLocationPicker } = useLocationManagement();

      // Open picker first
      showLocationPicker.value = true;

      const event = new CalendarEvent('event1', 'calendar1');
      event.locationId = 'loc1';
      event.location = new EventLocation('loc1', 'Test Venue');

      removeLocation(event);

      expect(event.locationId).toBeNull();
      expect(event.location).toBeInstanceOf(EventLocation);
      expect(event.location?.id).toBe('');
      expect(event.location?.name).toBe('');
      expect(showLocationPicker.value).toBe(false);
    });
  });

  describe('backToSearch', () => {
    it('should close create form and open picker', () => {
      const { backToSearch, showLocationPicker, showCreateLocationForm } = useLocationManagement();

      // Start with create form open
      showCreateLocationForm.value = true;

      backToSearch();

      expect(showCreateLocationForm.value).toBe(false);
      expect(showLocationPicker.value).toBe(true);
    });
  });

  describe('modal state transitions', () => {
    it('should transition from picker to create form and back', () => {
      const {
        openLocationPicker,
        createNewLocation,
        backToSearch,
        showLocationPicker,
        showCreateLocationForm,
      } = useLocationManagement();

      // Mock the service
      vi.spyOn(LocationService.prototype, 'getLocations').mockResolvedValue([]);

      // Start at initial state
      expect(showLocationPicker.value).toBe(false);
      expect(showCreateLocationForm.value).toBe(false);

      // Transition to picker (async, but we can check the modal state after)
      openLocationPicker('calendar1');

      // Transition to create form
      createNewLocation();
      expect(showLocationPicker.value).toBe(false);
      expect(showCreateLocationForm.value).toBe(true);

      // Transition back to picker
      backToSearch();
      expect(showLocationPicker.value).toBe(true);
      expect(showCreateLocationForm.value).toBe(false);
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete location selection workflow', async () => {
      const mockLocations = [
        new EventLocation('loc1', 'Venue 1'),
        new EventLocation('loc2', 'Venue 2'),
      ];

      vi.spyOn(LocationService.prototype, 'getLocations').mockResolvedValue(mockLocations);

      const {
        openLocationPicker,
        selectLocation,
        availableLocations,
        showLocationPicker,
      } = useLocationManagement();

      const event = new CalendarEvent('event1', 'calendar1');

      // Open picker and fetch locations
      await openLocationPicker('calendar1');

      expect(availableLocations.value).toEqual(mockLocations);
      expect(showLocationPicker.value).toBe(true);

      // Select a location
      selectLocation(mockLocations[0], event);

      expect(event.locationId).toBe('loc1');
      expect(event.location).toEqual(mockLocations[0]);
      expect(showLocationPicker.value).toBe(false);
    });

    it('should handle complete location creation workflow', async () => {
      const newLocation = new EventLocation('loc3', 'New Venue', '789 Elm St');

      vi.spyOn(LocationService.prototype, 'getLocations').mockResolvedValue([]);
      vi.spyOn(LocationService.prototype, 'createLocation').mockResolvedValue(newLocation);

      const {
        openLocationPicker,
        createNewLocation,
        createLocation,
        availableLocations,
        showCreateLocationForm,
      } = useLocationManagement();

      const event = new CalendarEvent('event1', 'calendar1');

      // Open picker (no locations available)
      await openLocationPicker('calendar1');
      expect(availableLocations.value).toEqual([]);

      // Navigate to create form
      createNewLocation();
      expect(showCreateLocationForm.value).toBe(true);

      // Create new location
      await createLocation('calendar1', { name: 'New Venue' }, event);

      // Check that the location was added to availableLocations
      expect(availableLocations.value).toHaveLength(1);
      expect(availableLocations.value[0].id).toBe('loc3');
      expect(availableLocations.value[0].name).toBe('New Venue');

      // Check that it was assigned to the event
      expect(event.locationId).toBe('loc3');
      expect(event.location).toEqual(newLocation);
      expect(showCreateLocationForm.value).toBe(false);
    });
  });
});
