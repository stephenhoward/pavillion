import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import axios from 'axios';
import LocationService from '@/client/service/location';
import ModelService from '@/client/service/models';
import { EventLocation, EventLocationSpace } from '@/common/model/location';
import { CalendarNotFoundError, InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';
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

  describe('getSpaces', () => {
    it('should fetch all spaces for a place under a calendar', async () => {
      const mockSpaceData = {
        id: 'https://pavillion.dev/spaces/sp-123',
        placeId: 'place-1',
        content: {
          en: { language: 'en', name: 'Main Hall', accessibilityInfo: 'Step-free entry' },
        },
      };

      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.resolves({ data: [mockSpaceData] });

      const spaces = await service.getSpaces('mycal', 'place-1');

      expect(axiosGetStub.calledOnce).toBe(true);
      expect(axiosGetStub.calledWith('/api/v1/calendars/mycal/places/place-1/spaces')).toBe(true);
      expect(spaces).toHaveLength(1);
      expect(spaces[0]).toBeInstanceOf(EventLocationSpace);
      expect(spaces[0].id).toBe('https://pavillion.dev/spaces/sp-123');
      expect(spaces[0].placeId).toBe('place-1');
      expect(spaces[0].content('en').name).toBe('Main Hall');
    });

    it('should return an empty array when no spaces exist', async () => {
      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.resolves({ data: [] });

      const spaces = await service.getSpaces('mycal', 'place-1');

      expect(spaces).toEqual([]);
    });

    it('should not touch the location store when fetching spaces', async () => {
      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.resolves({ data: [] });

      await service.getSpaces('mycal', 'place-1');

      expect((mockStore.setLocationsForCalendar as sinon.SinonStub).called).toBe(false);
      expect((mockStore.addLocation as sinon.SinonStub).called).toBe(false);
      expect((mockStore.updateLocation as sinon.SinonStub).called).toBe(false);
      expect((mockStore.removeLocation as sinon.SinonStub).called).toBe(false);
    });

    it('should encode calendar URL name and place ID with special characters', async () => {
      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.resolves({ data: [] });

      await service.getSpaces('cal/123', 'https://example.com/places/456');

      expect(axiosGetStub.calledWith(
        '/api/v1/calendars/cal%2F123/places/https%3A%2F%2Fexample.com%2Fplaces%2F456/spaces',
      )).toBe(true);
    });

    it('should handle errors when fetching spaces', async () => {
      const axiosGetStub = sandbox.stub(axios, 'get');
      const consoleErrorStub = sandbox.stub(console, 'error');
      const testError = new Error('API Error');

      axiosGetStub.rejects(testError);

      await expect(service.getSpaces('mycal', 'place-1')).rejects.toThrow('API Error');
      expect(consoleErrorStub.calledWith('Error loading spaces:', testError)).toBe(true);
    });
  });

  describe('createSpace', () => {
    it('should POST contentByLang wrapped in { content } and return the created Space', async () => {
      const contentByLang = {
        en: { name: 'Main Hall', accessibilityInfo: 'Step-free entry' },
      };
      const mockResponseData = {
        id: 'https://pavillion.dev/spaces/sp-456',
        placeId: 'place-1',
        content: {
          en: { language: 'en', name: 'Main Hall', accessibilityInfo: 'Step-free entry' },
        },
      };

      const axiosPostStub = sandbox.stub(axios, 'post');
      axiosPostStub.resolves({ data: mockResponseData });

      const result = await service.createSpace('mycal', 'place-1', contentByLang);

      expect(axiosPostStub.calledOnce).toBe(true);
      expect(axiosPostStub.calledWith(
        '/api/v1/calendars/mycal/places/place-1/spaces',
        { content: contentByLang },
      )).toBe(true);
      expect(result).toBeInstanceOf(EventLocationSpace);
      expect(result.id).toBe('https://pavillion.dev/spaces/sp-456');
      expect(result.placeId).toBe('place-1');
      expect(result.content('en').name).toBe('Main Hall');
    });

    it('should not touch the location store when creating a space', async () => {
      const axiosPostStub = sandbox.stub(axios, 'post');
      axiosPostStub.resolves({
        data: { id: 'sp-1', placeId: 'place-1', content: {} },
      });

      await service.createSpace('mycal', 'place-1', { en: { name: 'X', accessibilityInfo: '' } });

      expect((mockStore.addLocation as sinon.SinonStub).called).toBe(false);
      expect((mockStore.updateLocation as sinon.SinonStub).called).toBe(false);
      expect((mockStore.setLocationsForCalendar as sinon.SinonStub).called).toBe(false);
      expect((mockStore.removeLocation as sinon.SinonStub).called).toBe(false);
    });

    it('should encode calendar URL name and place ID when creating', async () => {
      const axiosPostStub = sandbox.stub(axios, 'post');
      axiosPostStub.resolves({
        data: { id: 'sp-1', placeId: 'p/1', content: {} },
      });

      await service.createSpace('cal/123', 'p/1', { en: { name: 'X', accessibilityInfo: '' } });

      expect(axiosPostStub.calledWith(
        '/api/v1/calendars/cal%2F123/places/p%2F1/spaces',
        { content: { en: { name: 'X', accessibilityInfo: '' } } },
      )).toBe(true);
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
        service.createSpace('mycal', 'place-1', { en: { name: 'X', accessibilityInfo: '' } }),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });
  });

  describe('updateSpace', () => {
    it('should PUT contentByLang wrapped in { content } and return the updated Space', async () => {
      const contentByLang = {
        en: { name: 'Renamed Hall', accessibilityInfo: 'Updated info' },
      };
      const mockResponseData = {
        id: 'sp-789',
        placeId: 'place-1',
        content: {
          en: { language: 'en', name: 'Renamed Hall', accessibilityInfo: 'Updated info' },
        },
      };

      const axiosPutStub = sandbox.stub(axios, 'put');
      axiosPutStub.resolves({ data: mockResponseData });

      const result = await service.updateSpace('mycal', 'sp-789', contentByLang);

      expect(axiosPutStub.calledOnce).toBe(true);
      expect(axiosPutStub.calledWith(
        '/api/v1/calendars/mycal/spaces/sp-789',
        { content: contentByLang },
      )).toBe(true);
      expect(result).toBeInstanceOf(EventLocationSpace);
      expect(result.id).toBe('sp-789');
      expect(result.content('en').name).toBe('Renamed Hall');
    });

    it('should not touch the location store when updating a space', async () => {
      const axiosPutStub = sandbox.stub(axios, 'put');
      axiosPutStub.resolves({
        data: { id: 'sp-1', placeId: 'place-1', content: {} },
      });

      await service.updateSpace('mycal', 'sp-1', { en: { name: 'X', accessibilityInfo: '' } });

      expect((mockStore.addLocation as sinon.SinonStub).called).toBe(false);
      expect((mockStore.updateLocation as sinon.SinonStub).called).toBe(false);
      expect((mockStore.setLocationsForCalendar as sinon.SinonStub).called).toBe(false);
      expect((mockStore.removeLocation as sinon.SinonStub).called).toBe(false);
    });

    it('should encode calendar URL name and space ID when updating', async () => {
      const axiosPutStub = sandbox.stub(axios, 'put');
      axiosPutStub.resolves({
        data: { id: 'sp-1', placeId: 'place-1', content: {} },
      });

      await service.updateSpace('cal/123', 'https://example.com/sp/1', {
        en: { name: 'X', accessibilityInfo: '' },
      });

      expect(axiosPutStub.calledWith(
        '/api/v1/calendars/cal%2F123/spaces/https%3A%2F%2Fexample.com%2Fsp%2F1',
        { content: { en: { name: 'X', accessibilityInfo: '' } } },
      )).toBe(true);
    });

    it('should map CalendarNotFoundError responses through handleApiError', async () => {
      const mockError = {
        response: {
          data: {
            errorName: 'CalendarNotFoundError',
          },
        },
      };

      const axiosPutStub = sandbox.stub(axios, 'put');
      axiosPutStub.rejects(mockError);

      await expect(
        service.updateSpace('mycal', 'sp-missing', { en: { name: 'X', accessibilityInfo: '' } }),
      ).rejects.toThrow(CalendarNotFoundError);
    });

    it('should throw UnknownError for unrecognized error responses', async () => {
      const mockError = new Error('Unknown error');

      const axiosPutStub = sandbox.stub(axios, 'put');
      axiosPutStub.rejects(mockError);

      await expect(
        service.updateSpace('mycal', 'sp-1', { en: { name: 'X', accessibilityInfo: '' } }),
      ).rejects.toThrow(UnknownError);
    });
  });

  describe('deleteSpace', () => {
    it('should DELETE the Space endpoint with encoded params', async () => {
      const axiosDeleteStub = sandbox.stub(axios, 'delete');
      axiosDeleteStub.resolves({ data: {} });

      await service.deleteSpace('mycal', 'sp-123');

      expect(axiosDeleteStub.calledOnce).toBe(true);
      expect(axiosDeleteStub.calledWith('/api/v1/calendars/mycal/spaces/sp-123')).toBe(true);
    });

    it('should not touch the location store when deleting a space', async () => {
      const axiosDeleteStub = sandbox.stub(axios, 'delete');
      axiosDeleteStub.resolves({ data: {} });

      await service.deleteSpace('mycal', 'sp-123');

      expect((mockStore.removeLocation as sinon.SinonStub).called).toBe(false);
      expect((mockStore.addLocation as sinon.SinonStub).called).toBe(false);
      expect((mockStore.updateLocation as sinon.SinonStub).called).toBe(false);
      expect((mockStore.setLocationsForCalendar as sinon.SinonStub).called).toBe(false);
    });

    it('should encode calendar URL name and space ID when deleting', async () => {
      const axiosDeleteStub = sandbox.stub(axios, 'delete');
      axiosDeleteStub.resolves({ data: {} });

      await service.deleteSpace('cal/123', 'https://example.com/sp/1');

      expect(axiosDeleteStub.calledWith(
        '/api/v1/calendars/cal%2F123/spaces/https%3A%2F%2Fexample.com%2Fsp%2F1',
      )).toBe(true);
    });

    it('should map CalendarNotFoundError responses through handleApiError', async () => {
      const mockError = {
        response: {
          data: {
            errorName: 'CalendarNotFoundError',
          },
        },
      };

      const axiosDeleteStub = sandbox.stub(axios, 'delete');
      axiosDeleteStub.rejects(mockError);

      await expect(service.deleteSpace('mycal', 'sp-123')).rejects.toThrow(CalendarNotFoundError);
    });

    it('should throw UnknownError for unrecognized error responses', async () => {
      const mockError = new Error('Unknown error');

      const axiosDeleteStub = sandbox.stub(axios, 'delete');
      axiosDeleteStub.rejects(mockError);

      await expect(service.deleteSpace('mycal', 'sp-123')).rejects.toThrow(UnknownError);
    });
  });
});
