import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import axios from 'axios';
import LocationService from '@/client/service/location';
import ModelService from '@/client/service/models';
import { EventLocation, EventLocationSpace } from '@/common/model/location';
import {
  CalendarNotFoundError,
  InsufficientCalendarPermissionsError,
} from '@/common/exceptions/calendar';
import { UnknownError } from '@/common/exceptions';
import { useLocationStore } from '@/client/stores/locationStore';

// Mock axios
vi.mock('axios');

describe('LocationService', () => {
  const sandbox = sinon.createSandbox();
  let mockStore: ReturnType<typeof useLocationStore>;
  let service: LocationService;

  beforeEach(() => {
    mockStore = {
      locations: {},
      addLocation: sandbox.stub(),
      updateLocation: sandbox.stub(),
      setLocationsForCalendar: sandbox.stub(),
      removeLocation: sandbox.stub(),
    } as unknown as ReturnType<typeof useLocationStore>;
    service = new LocationService(mockStore);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getLocations', () => {
    it('should fetch all locations for a calendar', async () => {
      const mockLocationData = {
        id: 'https://pavillion.dev/places/loc-123',
        calendarId: 'cal-123',
        name: 'Test Venue',
        address: '123 Main St',
        city: 'Portland',
        state: 'OR',
        postalCode: '97201',
      };

      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.resolves({ data: [mockLocationData] });

      const locations = await service.getLocations('cal-123');

      expect(axiosGetStub.calledOnce).toBe(true);
      expect(axiosGetStub.calledWith('/api/v1/calendars/cal-123/locations')).toBe(true);
      expect(locations).toHaveLength(1);
      expect(locations[0]).toBeInstanceOf(EventLocation);
      expect(locations[0].id).toBe('https://pavillion.dev/places/loc-123');
      expect(locations[0].name).toBe('Test Venue');
    });

    it('should populate nested spaces[] from the response payload', async () => {
      const mockLocationData = {
        id: 'loc-123',
        name: 'Test Venue',
        spaces: [
          {
            id: 'sp-1',
            placeId: 'loc-123',
            content: { en: { name: 'Main Hall', accessibilityInfo: '' } },
          },
        ],
      };

      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.resolves({ data: [mockLocationData] });

      const locations = await service.getLocations('cal-123');

      expect(locations[0].spaces).toHaveLength(1);
      expect(locations[0].spaces[0]).toBeInstanceOf(EventLocationSpace);
      expect(locations[0].spaces[0].id).toBe('sp-1');
      expect(locations[0].spaces[0].content('en').name).toBe('Main Hall');
    });

    it('should update store after fetching locations', async () => {
      const mockLocationData = {
        id: 'loc-123',
        name: 'Test Venue',
        address: '123 Main St',
      };

      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.resolves({ data: [mockLocationData] });

      const locations = await service.getLocations('cal-123');

      expect(mockStore.setLocationsForCalendar.calledWith('cal-123', locations)).toBe(true);
    });

    it('should handle errors when fetching locations', async () => {
      const axiosGetStub = sandbox.stub(axios, 'get');
      const consoleErrorStub = sandbox.stub(console, 'error');
      const testError = new Error('API Error');

      axiosGetStub.rejects(testError);

      await expect(service.getLocations('cal-123')).rejects.toThrow('API Error');
      expect(consoleErrorStub.calledWith('Error loading locations:', testError)).toBe(true);
    });

    it('should encode calendar ID with special characters', async () => {
      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.resolves({ data: [] });

      await service.getLocations('cal/123');

      expect(axiosGetStub.calledWith('/api/v1/calendars/cal%2F123/locations')).toBe(true);
    });
  });

  describe('createLocation', () => {
    it('should create a new location using ModelService', async () => {
      const location = new EventLocation(undefined, 'New Venue', '456 Oak St', 'Portland', 'OR', '97202');

      const mockResponseData = {
        id: 'https://pavillion.dev/places/loc-456',
        name: 'New Venue',
        address: '456 Oak St',
        city: 'Portland',
        state: 'OR',
        postalCode: '97202',
      };

      const mockCreateModel = sandbox.stub(ModelService, 'createModel');
      mockCreateModel.resolves(mockResponseData);

      const result = await service.createLocation('cal-123', location);

      expect(mockCreateModel.calledOnce).toBe(true);
      expect(mockCreateModel.calledWith(location, '/api/v1/calendars/cal-123/locations')).toBe(true);
      expect(result).toBeInstanceOf(EventLocation);
      expect(result.id).toBe('https://pavillion.dev/places/loc-456');
      expect(result.name).toBe('New Venue');
    });

    it('should preserve clientId echoes on newly-created spaces from the response', async () => {
      // The wire contract carries `clientId` on each new Space row in the
      // response so the editor can map staged-anchor → server-assigned id.
      const location = new EventLocation(undefined, 'New Venue');
      const stagedSpace = new EventLocationSpace(undefined, '');
      stagedSpace.clientId = 'client-temp-uuid-1';
      location.spaces = [stagedSpace];

      const mockResponseData = {
        id: 'loc-456',
        name: 'New Venue',
        spaces: [
          {
            id: 'server-assigned-uuid-1',
            placeId: 'loc-456',
            clientId: 'client-temp-uuid-1',
            content: { en: { name: 'Main Hall', accessibilityInfo: '' } },
          },
        ],
      };

      const mockCreateModel = sandbox.stub(ModelService, 'createModel');
      mockCreateModel.resolves(mockResponseData);

      const result = await service.createLocation('cal-123', location);

      expect(result.spaces).toHaveLength(1);
      expect(result.spaces[0].id).toBe('server-assigned-uuid-1');
      expect(result.spaces[0].clientId).toBe('client-temp-uuid-1');
    });

    it('should update store after creating location', async () => {
      const location = new EventLocation(undefined, 'New Venue', '456 Oak St');

      const mockResponseData = {
        id: 'loc-456',
        name: 'New Venue',
        address: '456 Oak St',
      };

      const mockCreateModel = sandbox.stub(ModelService, 'createModel');
      mockCreateModel.resolves(mockResponseData);

      const result = await service.createLocation('cal-123', location);

      expect(mockStore.addLocation.calledWith('cal-123', result)).toBe(true);
    });

    it('should handle API errors with handleApiError', async () => {
      const location = new EventLocation(undefined, 'Test', '123 Main St');

      const mockError = {
        response: {
          data: {
            errorName: 'CalendarNotFoundError',
          },
        },
      };

      const mockCreateModel = sandbox.stub(ModelService, 'createModel');
      mockCreateModel.rejects(mockError);

      await expect(service.createLocation('cal-123', location)).rejects.toThrow(CalendarNotFoundError);
    });

    it('should encode calendar ID when creating', async () => {
      const location = new EventLocation(undefined, 'Test Venue');

      const mockCreateModel = sandbox.stub(ModelService, 'createModel');
      mockCreateModel.resolves({ id: 'loc-1', name: 'Test Venue' });

      await service.createLocation('cal/123', location);

      expect(mockCreateModel.calledWith(location, '/api/v1/calendars/cal%2F123/locations')).toBe(true);
    });
  });

  describe('getLocationById', () => {
    it('should fetch a specific location', async () => {
      const mockLocationData = {
        id: 'https://pavillion.dev/places/loc-123',
        calendarId: 'cal-123',
        name: 'Test Venue',
        address: '123 Main St',
      };

      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.resolves({ data: mockLocationData });

      const location = await service.getLocationById('cal-123', 'https://pavillion.dev/places/loc-123');

      expect(axiosGetStub.calledOnce).toBe(true);
      expect(location).toBeInstanceOf(EventLocation);
      expect(location.id).toBe('https://pavillion.dev/places/loc-123');
    });

    it('should encode both calendar ID and location ID', async () => {
      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.resolves({ data: { id: 'loc-1', name: 'Test' } });

      await service.getLocationById('cal/123', 'https://example.com/loc/456');

      expect(axiosGetStub.calledWith(
        '/api/v1/calendars/cal%2F123/locations/https%3A%2F%2Fexample.com%2Floc%2F456',
      )).toBe(true);
    });
  });

  describe('updateLocation', () => {
    it('should update a location using ModelService', async () => {
      const location = new EventLocation('loc-123', 'Updated Venue', '789 Elm St', 'Portland', 'OR', '97203');

      const mockResponseData = {
        id: 'loc-123',
        name: 'Updated Venue',
        address: '789 Elm St',
        city: 'Portland',
        state: 'OR',
        postalCode: '97203',
      };

      const mockUpdateModel = sandbox.stub(ModelService, 'updateModel');
      mockUpdateModel.resolves(mockResponseData);

      const result = await service.updateLocation('cal-123', location);

      expect(mockUpdateModel.calledOnce).toBe(true);
      expect(mockUpdateModel.calledWith(location, '/api/v1/calendars/cal-123/locations')).toBe(true);
      expect(result).toBeInstanceOf(EventLocation);
      expect(result.name).toBe('Updated Venue');
    });

    it('should preserve clientId echoes on newly-created spaces from the response', async () => {
      // Snapshot semantics: PUT body carries the full `spaces[]` array. Newly
      // staged entries arrive with a `clientId` only; the response echoes that
      // `clientId` alongside the server-assigned `id` so the editor can patch
      // local state.
      const location = new EventLocation('loc-123', 'Updated Venue');
      const existing = new EventLocationSpace('sp-existing', 'loc-123');
      const staged = new EventLocationSpace(undefined, '');
      staged.clientId = 'client-temp-uuid-2';
      location.spaces = [existing, staged];

      const mockResponseData = {
        id: 'loc-123',
        name: 'Updated Venue',
        spaces: [
          {
            id: 'sp-existing',
            placeId: 'loc-123',
            content: { en: { name: 'Old Hall', accessibilityInfo: '' } },
          },
          {
            id: 'server-assigned-uuid-2',
            placeId: 'loc-123',
            clientId: 'client-temp-uuid-2',
            content: { en: { name: 'New Hall', accessibilityInfo: '' } },
          },
        ],
      };

      const mockUpdateModel = sandbox.stub(ModelService, 'updateModel');
      mockUpdateModel.resolves(mockResponseData);

      const result = await service.updateLocation('cal-123', location);

      expect(result.spaces).toHaveLength(2);
      expect(result.spaces[0].clientId).toBeUndefined();
      expect(result.spaces[1].id).toBe('server-assigned-uuid-2');
      expect(result.spaces[1].clientId).toBe('client-temp-uuid-2');
    });

    it('should update store after updating location', async () => {
      const location = new EventLocation('loc-123', 'Updated Venue');

      const mockResponseData = {
        id: 'loc-123',
        name: 'Updated Venue',
      };

      const mockUpdateModel = sandbox.stub(ModelService, 'updateModel');
      mockUpdateModel.resolves(mockResponseData);

      const result = await service.updateLocation('cal-123', location);

      expect(mockStore.updateLocation.calledWith('cal-123', result)).toBe(true);
    });

    it('should handle API errors with handleApiError', async () => {
      const location = new EventLocation('loc-123', 'Updated Venue');

      const mockError = {
        response: {
          data: {
            errorName: 'InsufficientCalendarPermissionsError',
          },
        },
      };

      const mockUpdateModel = sandbox.stub(ModelService, 'updateModel');
      mockUpdateModel.rejects(mockError);

      await expect(service.updateLocation('cal-123', location)).rejects.toThrow(InsufficientCalendarPermissionsError);
    });
  });

  describe('deleteLocation', () => {
    it('should delete a location', async () => {
      const axiosDeleteStub = sandbox.stub(axios, 'delete');
      axiosDeleteStub.resolves({ data: {} });

      await service.deleteLocation('cal-123', 'loc-123');

      expect(axiosDeleteStub.calledOnce).toBe(true);
      expect(axiosDeleteStub.calledWith('/api/v1/calendars/cal-123/locations/loc-123')).toBe(true);
    });

    it('should remove location from store after deletion', async () => {
      const axiosDeleteStub = sandbox.stub(axios, 'delete');
      axiosDeleteStub.resolves({ data: {} });

      await service.deleteLocation('cal-123', 'loc-123');

      expect(mockStore.removeLocation.calledWith('cal-123', 'loc-123')).toBe(true);
    });

    it('should handle delete errors with handleApiError', async () => {
      const mockError = {
        response: {
          data: {
            errorName: 'CalendarNotFoundError',
          },
        },
      };

      const axiosDeleteStub = sandbox.stub(axios, 'delete');
      axiosDeleteStub.rejects(mockError);

      await expect(service.deleteLocation('cal-123', 'loc-123')).rejects.toThrow(CalendarNotFoundError);
    });
  });

  describe('reassignEvents', () => {
    it('should POST { fromSpaceId, toSpaceId } to the action-path endpoint and return { count }', async () => {
      const axiosPostStub = sandbox.stub(axios, 'post');
      axiosPostStub.resolves({ data: { count: 3 } });

      const result = await service.reassignEvents('cal-123', 'loc-1', 'sp-from', 'sp-to');

      expect(axiosPostStub.calledOnce).toBe(true);
      expect(axiosPostStub.calledWith(
        '/api/v1/calendars/cal-123/locations/loc-1/reassign-events',
        { fromSpaceId: 'sp-from', toSpaceId: 'sp-to' },
      )).toBe(true);
      expect(result).toStrictEqual({ count: 3 });
    });

    it('should encode calendar ID and place ID with special characters', async () => {
      const axiosPostStub = sandbox.stub(axios, 'post');
      axiosPostStub.resolves({ data: { count: 0 } });

      await service.reassignEvents('cal/123', 'https://example.com/places/loc-1', 'sp-a', 'sp-b');

      expect(axiosPostStub.calledWith(
        '/api/v1/calendars/cal%2F123/locations/https%3A%2F%2Fexample.com%2Fplaces%2Floc-1/reassign-events',
        { fromSpaceId: 'sp-a', toSpaceId: 'sp-b' },
      )).toBe(true);
    });

    it('should not touch the location store on a successful reassign', async () => {
      const axiosPostStub = sandbox.stub(axios, 'post');
      axiosPostStub.resolves({ data: { count: 1 } });

      await service.reassignEvents('cal-123', 'loc-1', 'sp-from', 'sp-to');

      expect((mockStore.addLocation as sinon.SinonStub).called).toBe(false);
      expect((mockStore.updateLocation as sinon.SinonStub).called).toBe(false);
      expect((mockStore.setLocationsForCalendar as sinon.SinonStub).called).toBe(false);
      expect((mockStore.removeLocation as sinon.SinonStub).called).toBe(false);
    });

    it('should map ValidationError responses through handleApiError', async () => {
      const mockError = {
        response: {
          data: {
            errorName: 'ValidationError',
            error: 'toSpaceId does not reference a Space on this Place',
          },
        },
      };

      const axiosPostStub = sandbox.stub(axios, 'post');
      axiosPostStub.rejects(mockError);

      await expect(
        service.reassignEvents('cal-123', 'loc-1', 'sp-from', 'sp-to'),
      ).rejects.toThrow();
    });

    it('should map InsufficientCalendarPermissionsError responses through handleApiError', async () => {
      const mockError = {
        response: {
          data: {
            errorName: 'InsufficientCalendarPermissionsError',
          },
        },
      };

      const axiosPostStub = sandbox.stub(axios, 'post');
      axiosPostStub.rejects(mockError);

      await expect(
        service.reassignEvents('cal-123', 'loc-1', 'sp-from', 'sp-to'),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });

    it('should throw UnknownError for unrecognized error responses', async () => {
      const mockError = new Error('Boom');

      const axiosPostStub = sandbox.stub(axios, 'post');
      axiosPostStub.rejects(mockError);

      await expect(
        service.reassignEvents('cal-123', 'loc-1', 'sp-from', 'sp-to'),
      ).rejects.toThrow(UnknownError);
    });
  });

  describe('error handling', () => {
    it('should throw UnknownError for unrecognized errors in mutating operations', async () => {
      const location = new EventLocation(undefined, 'Test');
      const mockError = new Error('Unknown error');

      const mockCreateModel = sandbox.stub(ModelService, 'createModel');
      mockCreateModel.rejects(mockError);

      await expect(service.createLocation('cal-123', location)).rejects.toThrow(UnknownError);
    });

    it('should handle malformed error responses', async () => {
      const location = new EventLocation(undefined, 'Test');
      const mockError = {
        response: {
          data: {
            // Missing errorName
          },
        },
      };

      const mockCreateModel = sandbox.stub(ModelService, 'createModel');
      mockCreateModel.rejects(mockError);

      await expect(service.createLocation('cal-123', location)).rejects.toThrow(UnknownError);
    });
  });
});
