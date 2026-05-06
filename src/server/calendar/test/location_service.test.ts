import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Calendar } from '@/common/model/calendar';
import { EventLocation, EventLocationContent } from '@/common/model/location';
import { LocationEntity, LocationContentEntity } from '@/server/calendar/entity/location';
import { LocationSpaceEntity, LocationSpaceContentEntity } from '@/server/calendar/entity/location_space';
import { EventEntity } from '@/server/calendar/entity/event';
import db from '@/server/common/entity/db';
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

      // Stub getLocationById to return the created location with UUID id
      const getLocationByIdStub = sandbox.stub(service, 'getLocationById');
      getLocationByIdStub.callsFake((_calendar, id) => {
        return Promise.resolve(new EventLocation(id, 'testName'));
      });

      let location = await service.createLocation(
        new Calendar('testCalendarId', 'testme'),
        new EventLocation('', 'testName'),
      );

      // Regression: entity.id was set to a full URL instead of a UUID, causing PostgreSQL crash
      expect(location.id).toBeDefined();
      expect(location.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
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

    // Stub db.transaction so the cascade body runs inline with a fake tx handle.
    // Individual tests still set their own per-call stubs; this fixture only
    // wraps the transactional shell so the work executes synchronously.
    let txStub: sinon.SinonStub;
    beforeEach(() => {
      txStub = sandbox.stub(db, 'transaction').callsFake(async (callback: any) => {
        const fakeTx = { __brand: 'fake-tx' };
        return callback(fakeTx);
      });
    });

    it('should delete a location and nullify both location_id and space_id on referencing events', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const existingEntity = LocationEntity.build({
        id: 'loc-1',
        calendar_id: 'cal-1',
        name: 'Old Venue',
      });

      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
      findByPkStub.resolves(existingEntity);

      const eventUpdateStub = sandbox.stub(EventEntity, 'update').resolves([2]);
      // No Spaces under this Place — findAll returns empty so the Space-cascade
      // branch is skipped but the rest of the method still runs.
      const spaceFindAllStub = sandbox.stub(LocationSpaceEntity, 'findAll').resolves([]);
      const spaceContentDestroyStub = sandbox.stub(LocationSpaceContentEntity, 'destroy').resolves(0);
      const spaceDestroyStub = sandbox.stub(LocationSpaceEntity, 'destroy').resolves(0);
      const contentDestroyStub = sandbox.stub(LocationContentEntity, 'destroy').resolves(1);
      const destroyStub = sandbox.stub(existingEntity, 'destroy').resolves();

      const result = await service.deleteLocation(calendar, 'loc-1');

      expect(result).toBe(true);
      expect(txStub.calledOnce).toBe(true);

      // Event side-effect: BOTH FKs nullified, scoped by location_id (not space_id),
      // so events that referenced any Space under this Place also get cleared.
      expect(eventUpdateStub.calledOnce).toBe(true);
      expect(eventUpdateStub.firstCall.args[0]).toEqual({ location_id: null, space_id: null });
      expect((eventUpdateStub.firstCall.args[1] as any).where).toEqual({ location_id: 'loc-1' });

      expect(spaceFindAllStub.called).toBe(true);
      // Empty Space set: skip the per-space cascade branch
      expect(spaceContentDestroyStub.called).toBe(false);
      expect(spaceDestroyStub.called).toBe(false);

      expect(contentDestroyStub.called).toBe(true);
      expect(destroyStub.called).toBe(true);
    });

    it('cascades Space + content removal and nullifies event.space_id when the Place has Spaces', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const existingEntity = LocationEntity.build({
        id: 'place-1',
        calendar_id: 'cal-1',
        name: 'Convention Center',
      });

      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
      findByPkStub.resolves(existingEntity);

      const eventUpdateStub = sandbox.stub(EventEntity, 'update').resolves([1]);

      // Two Spaces under this Place
      const space1 = LocationSpaceEntity.build({ id: 'space-1', place_id: 'place-1' });
      const space2 = LocationSpaceEntity.build({ id: 'space-2', place_id: 'place-1' });
      const spaceFindAllStub = sandbox.stub(LocationSpaceEntity, 'findAll').resolves([space1, space2]);

      const spaceContentDestroyStub = sandbox.stub(LocationSpaceContentEntity, 'destroy').resolves(3);
      const spaceDestroyStub = sandbox.stub(LocationSpaceEntity, 'destroy').resolves(2);
      const contentDestroyStub = sandbox.stub(LocationContentEntity, 'destroy').resolves(1);
      const destroyStub = sandbox.stub(existingEntity, 'destroy').resolves();

      const result = await service.deleteLocation(calendar, 'place-1');

      expect(result).toBe(true);
      expect(txStub.calledOnce).toBe(true);

      // BOTH FKs nullified on referencing events
      expect(eventUpdateStub.firstCall.args[0]).toEqual({ location_id: null, space_id: null });

      // Space cascade ran — content destroyed for both Spaces, then Spaces themselves
      expect(spaceFindAllStub.calledOnce).toBe(true);
      expect((spaceFindAllStub.firstCall.args[0] as any).where).toEqual({ place_id: 'place-1' });
      expect(spaceContentDestroyStub.calledOnce).toBe(true);
      expect((spaceContentDestroyStub.firstCall.args[0] as any).where).toEqual({ space_id: ['space-1', 'space-2'] });
      expect(spaceDestroyStub.calledOnce).toBe(true);
      expect((spaceDestroyStub.firstCall.args[0] as any).where).toEqual({ place_id: 'place-1' });

      // Place content + Place itself still destroyed
      expect(contentDestroyStub.calledOnce).toBe(true);
      expect(destroyStub.calledOnce).toBe(true);
    });

    it('runs the entire cascade inside a single db.transaction', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const existingEntity = LocationEntity.build({
        id: 'place-1',
        calendar_id: 'cal-1',
        name: 'Venue',
      });
      const space1 = LocationSpaceEntity.build({ id: 'space-1', place_id: 'place-1' });

      sandbox.stub(LocationEntity, 'findByPk').resolves(existingEntity);
      const eventUpdateStub = sandbox.stub(EventEntity, 'update').resolves([0]);
      const spaceFindAllStub = sandbox.stub(LocationSpaceEntity, 'findAll').resolves([space1]);
      const spaceContentDestroyStub = sandbox.stub(LocationSpaceContentEntity, 'destroy').resolves(0);
      const spaceDestroyStub = sandbox.stub(LocationSpaceEntity, 'destroy').resolves(1);
      const contentDestroyStub = sandbox.stub(LocationContentEntity, 'destroy').resolves(0);
      const placeDestroyStub = sandbox.stub(existingEntity, 'destroy').resolves();

      const result = await service.deleteLocation(calendar, 'place-1');

      expect(result).toBe(true);
      // Single transaction wraps the cascade
      expect(txStub.calledOnce).toBe(true);

      // Every write inside the cascade must thread the same tx handle through
      // its options object. The handle is the value our stub passed to the
      // db.transaction callback (recovered here from the first stubbed call).
      const eventOpts = eventUpdateStub.firstCall.args[1] as any;
      expect(eventOpts.transaction).toBeDefined();
      const tx = eventOpts.transaction;

      expect((spaceFindAllStub.firstCall.args[0] as any).transaction).toBe(tx);
      expect((spaceContentDestroyStub.firstCall.args[0] as any).transaction).toBe(tx);
      expect((spaceDestroyStub.firstCall.args[0] as any).transaction).toBe(tx);
      expect((contentDestroyStub.firstCall.args[0] as any).transaction).toBe(tx);
      expect(placeDestroyStub.firstCall.args[0]).toEqual({ transaction: tx });
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
