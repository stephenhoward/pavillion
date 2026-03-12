import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Calendar } from '@/common/model/calendar';
import { EventLocation, EventLocationContent } from '@/common/model/location';
import { LocationEntity, LocationContentEntity } from '@/server/calendar/entity/location';
import { EventEntity } from '@/server/calendar/entity/event';
import LocationService from '@/server/calendar/service/locations';

describe('LocationService', () => {

  let sandbox: sinon.SinonSandbox;
  let service: LocationService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new LocationService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('findLocation', () => {

    it('should return a location by id', async () => {
      let findLocationStub = sandbox.stub(LocationEntity, 'findByPk');
      let calendar = new Calendar('calid', 'testme');

      findLocationStub.resolves(LocationEntity.build({
        calendar_id: calendar.id,
        name: 'testLocation',
      }));

      let location = await service.findLocation(
        calendar,
        new EventLocation('id', 'testLocation'),
      );

      expect(location).toBeDefined();
      expect(findLocationStub.called).toBe(true);
    });

    it('calendar id mismatch', async () => {
      let findLocationStub = sandbox.stub(LocationEntity, 'findByPk');
      let calendar = new Calendar('calid', 'testme');

      findLocationStub.resolves(LocationEntity.build({
        calendar_id: 'someOtherCalendarId',
        name: 'testLocation',
      }));

      let location = await service.findLocation(
        calendar,
        new EventLocation('id', 'testLocation'),
      );

      expect(location).toBeNull();
      expect(findLocationStub.called).toBe(true);
    });

    it('no location with that id', async () => {
      let findLocationStub = sandbox.stub(LocationEntity, 'findByPk');
      findLocationStub.resolves(undefined);

      let location = await service.findLocation(
        new Calendar('id', 'testme'),
        new EventLocation('id', 'testLocation'),
      );

      expect(location).toBeNull();
      expect(findLocationStub.called).toBe(true);
    });

    it('match by attributes', async () => {
      let findLocationStub = sandbox.stub(LocationEntity, 'findOne');
      findLocationStub.resolves(LocationEntity.build({ name: 'testLocation' }));

      let location = await service.findLocation(
        new Calendar('id', 'testme'),
        new EventLocation('', 'testLocation'),
      );

      expect(location).toBeDefined();
      expect(findLocationStub.called).toBe(true);
    });

    it('no matches by attribute', async () => {
      let findLocationStub = sandbox.stub(LocationEntity, 'findOne');
      findLocationStub.resolves(undefined);

      let location = await service.findLocation(
        new Calendar('id', 'testme'),
        new EventLocation('', 'testLocation'),
      );

      expect(location).toBeNull();
      expect(findLocationStub.called).toBe(true);
    });
  });

  describe('createLocation', () => {

    it('should create a location', async () => {
      let saveStub = sandbox.stub(LocationEntity.prototype, 'save');
      let eventSpy = sandbox.spy(LocationEntity, 'fromModel');

      // Stub getLocationById to return the created location
      const getLocationByIdStub = sandbox.stub(service, 'getLocationById');
      const expectedLocation = new EventLocation(
        'https://pavillion.dev/places/test-id',
        'testName',
      );
      getLocationByIdStub.resolves(expectedLocation);

      let location = await service.createLocation(
        new Calendar('testCalendarId', 'testme'),
        new EventLocation('', 'testName'),
      );

      expect(location.id).toBeDefined();
      expect(location.id).toMatch(/^https:\/\/pavillion.dev\/places\/[a-z0-9-]+$/);
      expect(eventSpy.returnValues[0].calendar_id).toBe('testCalendarId');
      expect(saveStub.called).toBe(true);
    });
  });

  describe('updateLocation', () => {

    it('should update location fields', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const existingEntity = LocationEntity.build({
        id: 'loc-1',
        calendar_id: 'cal-1',
        name: 'Old Name',
        address: '123 Old St',
        city: 'Old City',
        state: 'OC',
        postal_code: '00000',
        country: 'US',
      });

      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
      findByPkStub.resolves(existingEntity);

      const updateStub = sandbox.stub(existingEntity, 'update').resolves(existingEntity);

      // Stub content operations
      sandbox.stub(LocationContentEntity, 'destroy').resolves(0);

      // Stub getLocationById to return updated location
      const getLocationByIdStub = sandbox.stub(service, 'getLocationById');
      const updatedLocation = new EventLocation('loc-1', 'New Name', '456 New St', 'New City', 'NC', '11111', 'US');
      getLocationByIdStub.resolves(updatedLocation);

      const locationData = new EventLocation('loc-1', 'New Name', '456 New St', 'New City', 'NC', '11111', 'US');
      const result = await service.updateLocation(calendar, 'loc-1', locationData);

      expect(result).toBeDefined();
      expect(result!.name).toBe('New Name');
      expect(updateStub.called).toBe(true);
    });

    it('should return null if location not found', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
      findByPkStub.resolves(null);

      const locationData = new EventLocation('', 'New Name');
      const result = await service.updateLocation(calendar, 'nonexistent', locationData);

      expect(result).toBeNull();
    });

    it('should return null if location belongs to different calendar', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const existingEntity = LocationEntity.build({
        id: 'loc-1',
        calendar_id: 'other-cal',
        name: 'Some Name',
      });

      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
      findByPkStub.resolves(existingEntity);

      const locationData = new EventLocation('', 'New Name');
      const result = await service.updateLocation(calendar, 'loc-1', locationData);

      expect(result).toBeNull();
    });

    it('should throw error if name is empty', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const existingEntity = LocationEntity.build({
        id: 'loc-1',
        calendar_id: 'cal-1',
        name: 'Old Name',
      });

      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
      findByPkStub.resolves(existingEntity);

      const locationData = new EventLocation('', '');
      await expect(service.updateLocation(calendar, 'loc-1', locationData))
        .rejects.toThrow('Location name is required');
    });

    it('should update content for existing languages', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const existingEntity = LocationEntity.build({
        id: 'loc-1',
        calendar_id: 'cal-1',
        name: 'Venue',
      });

      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
      findByPkStub.resolves(existingEntity);
      sandbox.stub(existingEntity, 'update').resolves(existingEntity);

      const destroyStub = sandbox.stub(LocationContentEntity, 'destroy').resolves(1);
      const saveStub = sandbox.stub(LocationContentEntity.prototype, 'save').resolves();

      const getLocationByIdStub = sandbox.stub(service, 'getLocationById');
      const updatedLocation = new EventLocation('loc-1', 'Venue');
      const content = new EventLocationContent('en', 'Wheelchair accessible');
      updatedLocation.addContent(content);
      getLocationByIdStub.resolves(updatedLocation);

      const locationData = new EventLocation('loc-1', 'Venue');
      locationData.addContent(new EventLocationContent('en', 'Wheelchair accessible'));

      const result = await service.updateLocation(calendar, 'loc-1', locationData);

      expect(result).toBeDefined();
      expect(destroyStub.called).toBe(true);
    });
  });

  describe('deleteLocation', () => {

    it('should delete a location and nullify event references', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const existingEntity = LocationEntity.build({
        id: 'loc-1',
        calendar_id: 'cal-1',
        name: 'Old Venue',
      });

      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
      findByPkStub.resolves(existingEntity);

      const eventUpdateStub = sandbox.stub(EventEntity, 'update').resolves([2]);
      const contentDestroyStub = sandbox.stub(LocationContentEntity, 'destroy').resolves(1);
      const destroyStub = sandbox.stub(existingEntity, 'destroy').resolves();

      const result = await service.deleteLocation(calendar, 'loc-1');

      expect(result).toBe(true);
      expect(eventUpdateStub.called).toBe(true);
      expect(eventUpdateStub.firstCall.args[0]).toEqual({ location_id: null });
      expect(eventUpdateStub.firstCall.args[1].where).toEqual({ location_id: 'loc-1' });
      expect(contentDestroyStub.called).toBe(true);
      expect(destroyStub.called).toBe(true);
    });

    it('should return false if location not found', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
      findByPkStub.resolves(null);

      const result = await service.deleteLocation(calendar, 'nonexistent');

      expect(result).toBe(false);
    });

    it('should return false if location belongs to different calendar', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const existingEntity = LocationEntity.build({
        id: 'loc-1',
        calendar_id: 'other-cal',
        name: 'Venue',
      });

      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
      findByPkStub.resolves(existingEntity);

      const result = await service.deleteLocation(calendar, 'loc-1');

      expect(result).toBe(false);
    });
  });
});
