import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Calendar } from '@/common/model/calendar';
import { EventLocation, EventLocationContent } from '@/common/model/location';
import { LocationEntity, LocationContentEntity } from '@/server/calendar/entity/location';
import LocationService from '@/server/calendar/service/locations';

describe('LocationService - Enhanced Methods', () => {
  let sandbox = sinon.createSandbox();
  let service: LocationService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new LocationService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getLocationsForCalendar', () => {
    it('should return all locations for a calendar', async () => {
      const calendar = new Calendar('cal-123', 'testcalendar');

      const location1 = LocationEntity.build({
        id: 'https://pavillion.dev/places/loc-1',
        calendar_id: 'cal-123',
        name: 'Washington Park',
        address: '4033 SW Canyon Rd',
        city: 'Portland',
        state: 'OR',
        postal_code: '97221',
      });

      const location2 = LocationEntity.build({
        id: 'https://pavillion.dev/places/loc-2',
        calendar_id: 'cal-123',
        name: 'Community Center',
        address: '123 Main St',
        city: 'Portland',
        state: 'OR',
        postal_code: '97201',
      });

      // Mock findAll to return locations with content
      const findAllStub = sandbox.stub(LocationEntity, 'findAll');
      findAllStub.resolves([location1, location2]);

      const locations = await service.getLocationsForCalendar(calendar);

      expect(locations).toHaveLength(2);
      expect(locations[0]).toBeInstanceOf(EventLocation);
      expect(locations[0].name).toBe('Washington Park');
      expect(locations[1].name).toBe('Community Center');
      expect(findAllStub.calledOnce).toBe(true);
      expect(findAllStub.firstCall.args[0]).toHaveProperty('where');
      expect(findAllStub.firstCall.args[0].where).toEqual({ calendar_id: 'cal-123' });
    });

    it('should eager load content when fetching locations', async () => {
      const calendar = new Calendar('cal-123', 'testcalendar');

      const location = LocationEntity.build({
        id: 'https://pavillion.dev/places/loc-1',
        calendar_id: 'cal-123',
        name: 'Washington Park',
      });

      const contentEntity = LocationContentEntity.build({
        id: 'content-1',
        location_id: 'https://pavillion.dev/places/loc-1',
        language: 'en',
        accessibility_info: 'Wheelchair accessible paths.',
      });

      location.content = [contentEntity];

      const findAllStub = sandbox.stub(LocationEntity, 'findAll');
      findAllStub.resolves([location]);

      const locations = await service.getLocationsForCalendar(calendar);

      expect(locations).toHaveLength(1);
      expect(locations[0].getLanguages()).toHaveLength(1);
      expect(locations[0].content('en').accessibilityInfo).toBe('Wheelchair accessible paths.');
      expect(findAllStub.firstCall.args[0]).toHaveProperty('include');
    });

    it('should return empty array when calendar has no locations', async () => {
      const calendar = new Calendar('cal-456', 'emptycal');

      const findAllStub = sandbox.stub(LocationEntity, 'findAll');
      findAllStub.resolves([]);

      const locations = await service.getLocationsForCalendar(calendar);

      expect(locations).toHaveLength(0);
      expect(findAllStub.calledOnce).toBe(true);
    });
  });

  describe('getLocationById', () => {
    it('should return location by id when it belongs to calendar', async () => {
      const calendar = new Calendar('cal-123', 'testcalendar');

      const locationEntity = LocationEntity.build({
        id: 'https://pavillion.dev/places/loc-1',
        calendar_id: 'cal-123',
        name: 'Washington Park',
        address: '4033 SW Canyon Rd',
      });

      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
      findByPkStub.resolves(locationEntity);

      const location = await service.getLocationById(calendar, 'https://pavillion.dev/places/loc-1');

      expect(location).toBeInstanceOf(EventLocation);
      expect(location?.name).toBe('Washington Park');
      expect(findByPkStub.calledOnce).toBe(true);
    });

    it('should return null when location belongs to different calendar', async () => {
      const calendar = new Calendar('cal-123', 'testcalendar');

      const locationEntity = LocationEntity.build({
        id: 'https://pavillion.dev/places/loc-1',
        calendar_id: 'cal-456', // Different calendar
        name: 'Washington Park',
      });

      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
      findByPkStub.resolves(locationEntity);

      const location = await service.getLocationById(calendar, 'https://pavillion.dev/places/loc-1');

      expect(location).toBeNull();
      expect(findByPkStub.calledOnce).toBe(true);
    });

    it('should return null when location does not exist', async () => {
      const calendar = new Calendar('cal-123', 'testcalendar');

      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
      findByPkStub.resolves(null);

      const location = await service.getLocationById(calendar, 'https://pavillion.dev/places/nonexistent');

      expect(location).toBeNull();
      expect(findByPkStub.calledOnce).toBe(true);
    });

    it('should eager load content when fetching location by id', async () => {
      const calendar = new Calendar('cal-123', 'testcalendar');

      const locationEntity = LocationEntity.build({
        id: 'https://pavillion.dev/places/loc-1',
        calendar_id: 'cal-123',
        name: 'Washington Park',
      });

      const contentEntity = LocationContentEntity.build({
        id: 'content-1',
        location_id: 'https://pavillion.dev/places/loc-1',
        language: 'es',
        accessibility_info: 'Caminos accesibles.',
      });

      locationEntity.content = [contentEntity];

      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
      findByPkStub.resolves(locationEntity);

      const location = await service.getLocationById(calendar, 'https://pavillion.dev/places/loc-1');

      expect(location?.getLanguages()).toHaveLength(1);
      expect(location?.content('es').accessibilityInfo).toBe('Caminos accesibles.');
      expect(findByPkStub.firstCall.args[1]).toHaveProperty('include');
    });
  });

  describe('createLocation with content', () => {
    it('should create location with accessibility content', async () => {
      const calendar = new Calendar('cal-123', 'testcalendar');

      const location = new EventLocation(
        undefined,
        'Community Center',
        '123 Main St',
        'Portland',
        'OR',
        '97201',
      );

      const content = new EventLocationContent('en', 'Elevator access to all floors.');
      location.addContent(content);

      const saveStub = sandbox.stub(LocationEntity.prototype, 'save');
      const contentSaveStub = sandbox.stub(LocationContentEntity.prototype, 'save');

      // Stub getLocationById to return the created location
      const getLocationByIdStub = sandbox.stub(service, 'getLocationById');
      const expectedLocation = new EventLocation(
        'https://pavillion.dev/places/new-id',
        'Community Center',
        '123 Main St',
        'Portland',
        'OR',
        '97201',
      );
      expectedLocation.addContent(content);
      getLocationByIdStub.resolves(expectedLocation);

      const createdLocation = await service.createLocation(calendar, location);

      expect(createdLocation.id).toBeDefined();
      expect(createdLocation.name).toBe('Community Center');
      expect(createdLocation.getLanguages()).toHaveLength(1);
      expect(createdLocation.content('en').accessibilityInfo).toBe('Elevator access to all floors.');
      expect(saveStub.calledOnce).toBe(true);
      expect(contentSaveStub.calledOnce).toBe(true);
    });

    it('should create location without content', async () => {
      const calendar = new Calendar('cal-123', 'testcalendar');

      const location = new EventLocation(
        undefined,
        'Simple Venue',
        '456 Oak St',
      );

      const saveStub = sandbox.stub(LocationEntity.prototype, 'save');

      // Stub getLocationById to return the created location
      const getLocationByIdStub = sandbox.stub(service, 'getLocationById');
      const expectedLocation = new EventLocation(
        'https://pavillion.dev/places/new-id',
        'Simple Venue',
        '456 Oak St',
      );
      getLocationByIdStub.resolves(expectedLocation);

      const createdLocation = await service.createLocation(calendar, location);

      expect(createdLocation.id).toBeDefined();
      expect(createdLocation.name).toBe('Simple Venue');
      expect(createdLocation.getLanguages()).toHaveLength(0);
      expect(saveStub.calledOnce).toBe(true);
    });

    it('should create location with multiple language content', async () => {
      const calendar = new Calendar('cal-123', 'testcalendar');

      const location = new EventLocation(
        undefined,
        'International Center',
        '789 Global Ave',
      );

      const enContent = new EventLocationContent('en', 'Wheelchair ramps available.');
      const esContent = new EventLocationContent('es', 'Rampas para sillas de ruedas disponibles.');
      location.addContent(enContent);
      location.addContent(esContent);

      const saveStub = sandbox.stub(LocationEntity.prototype, 'save');
      const contentSaveStub = sandbox.stub(LocationContentEntity.prototype, 'save');

      // Stub getLocationById to return the created location
      const getLocationByIdStub = sandbox.stub(service, 'getLocationById');
      const expectedLocation = new EventLocation(
        'https://pavillion.dev/places/new-id',
        'International Center',
        '789 Global Ave',
      );
      expectedLocation.addContent(enContent);
      expectedLocation.addContent(esContent);
      getLocationByIdStub.resolves(expectedLocation);

      const createdLocation = await service.createLocation(calendar, location);

      expect(createdLocation.getLanguages()).toHaveLength(2);
      expect(createdLocation.content('en').accessibilityInfo).toBe('Wheelchair ramps available.');
      expect(createdLocation.content('es').accessibilityInfo).toBe('Rampas para sillas de ruedas disponibles.');
      expect(saveStub.calledOnce).toBe(true);
      expect(contentSaveStub.calledTwice).toBe(true);
    });

    it('should validate location name is required', async () => {
      const calendar = new Calendar('cal-123', 'testcalendar');

      const location = new EventLocation(
        undefined,
        '', // Empty name
        '123 Main St',
      );

      await expect(service.createLocation(calendar, location)).rejects.toThrow('Location name is required');
    });

    it('should generate ActivityPub URI for location id', async () => {
      const calendar = new Calendar('cal-123', 'testcalendar');

      const location = new EventLocation(
        undefined,
        'Test Venue',
        '123 Test St',
      );

      const saveStub = sandbox.stub(LocationEntity.prototype, 'save');

      // Stub getLocationById to return the created location
      const getLocationByIdStub = sandbox.stub(service, 'getLocationById');
      const expectedLocation = new EventLocation(
        'https://pavillion.dev/places/a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'Test Venue',
        '123 Test St',
      );
      getLocationByIdStub.resolves(expectedLocation);

      const createdLocation = await service.createLocation(calendar, location);

      expect(createdLocation.id).toMatch(/^https:\/\/.*\/places\/[a-f0-9-]+$/);
      expect(saveStub.calledOnce).toBe(true);
    });
  });
});
