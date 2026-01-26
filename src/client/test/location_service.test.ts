import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import axios from 'axios';
import LocationService from '@/client/service/location';
import { EventLocation } from '@/common/model/location';

// Mock axios
vi.mock('axios');

describe('LocationService', () => {
  const sandbox = sinon.createSandbox();
  let service: LocationService;

  beforeEach(() => {
    service = new LocationService();
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
    it('should create a new location', async () => {
      const locationData = {
        name: 'New Venue',
        address: '456 Oak St',
        city: 'Portland',
        state: 'OR',
        postalCode: '97202',
        content: {
          en: {
            accessibilityInfo: 'Wheelchair accessible',
          },
        },
      };

      const mockResponseData = {
        id: 'https://pavillion.dev/places/loc-456',
        calendarId: 'cal-123',
        ...locationData,
      };

      const axiosPostStub = sandbox.stub(axios, 'post');
      axiosPostStub.resolves({ data: mockResponseData });

      const result = await service.createLocation('cal-123', locationData);

      expect(axiosPostStub.calledOnce).toBe(true);
      expect(axiosPostStub.calledWith('/api/v1/calendars/cal-123/locations', locationData)).toBe(true);
      expect(result).toBeInstanceOf(EventLocation);
      expect(result.id).toBe('https://pavillion.dev/places/loc-456');
      expect(result.name).toBe('New Venue');
    });

    it('should handle errors when creating location', async () => {
      const axiosPostStub = sandbox.stub(axios, 'post');
      const consoleErrorStub = sandbox.stub(console, 'error');
      const testError = new Error('API Error');

      axiosPostStub.rejects(testError);

      const locationData = { name: 'Test', address: '123 Main St' };

      await expect(service.createLocation('cal-123', locationData)).rejects.toThrow('API Error');
      expect(consoleErrorStub.calledWith('Error creating location:', testError)).toBe(true);
    });

    it('should encode calendar ID when creating', async () => {
      const axiosPostStub = sandbox.stub(axios, 'post');
      axiosPostStub.resolves({ data: { id: 'loc-1', name: 'Test' } });

      const locationData = { name: 'Test Venue' };
      await service.createLocation('cal/123', locationData);

      expect(axiosPostStub.calledWith('/api/v1/calendars/cal%2F123/locations', locationData)).toBe(true);
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
});
