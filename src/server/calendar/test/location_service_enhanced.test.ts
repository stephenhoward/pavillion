import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Calendar } from '@/common/model/calendar';
import { EventLocation, EventLocationContent } from '@/common/model/location';
import { LocationEntity, LocationContentEntity } from '@/server/calendar/entity/location';
import { LocationSpaceEntity } from '@/server/calendar/entity/location_space';
import db from '@/server/common/entity/db';
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
        id: 'a1b2c3d4-0001-4000-8000-000000000001',
        calendar_id: 'cal-123',
        name: 'Washington Park',
        address: '4033 SW Canyon Rd',
        city: 'Portland',
        state: 'OR',
        postal_code: '97221',
      });

      const location2 = LocationEntity.build({
        id: 'a1b2c3d4-0002-4000-8000-000000000002',
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
        id: 'a1b2c3d4-0001-4000-8000-000000000001',
        calendar_id: 'cal-123',
        name: 'Washington Park',
      });

      const contentEntity = LocationContentEntity.build({
        id: 'content-1',
        location_id: 'a1b2c3d4-0001-4000-8000-000000000001',
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
        id: 'a1b2c3d4-0001-4000-8000-000000000001',
        calendar_id: 'cal-123',
        name: 'Washington Park',
        address: '4033 SW Canyon Rd',
      });

      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
      findByPkStub.resolves(locationEntity);

      const location = await service.getLocationById(calendar, 'a1b2c3d4-0001-4000-8000-000000000001');

      expect(location).toBeInstanceOf(EventLocation);
      expect(location?.name).toBe('Washington Park');
      expect(findByPkStub.calledOnce).toBe(true);
    });

    it('should return null when location belongs to different calendar', async () => {
      const calendar = new Calendar('cal-123', 'testcalendar');

      const locationEntity = LocationEntity.build({
        id: 'a1b2c3d4-0001-4000-8000-000000000001',
        calendar_id: 'cal-456', // Different calendar
        name: 'Washington Park',
      });

      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
      findByPkStub.resolves(locationEntity);

      const location = await service.getLocationById(calendar, 'a1b2c3d4-0001-4000-8000-000000000001');

      expect(location).toBeNull();
      expect(findByPkStub.calledOnce).toBe(true);
    });

    it('should return null when location does not exist', async () => {
      const calendar = new Calendar('cal-123', 'testcalendar');

      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
      findByPkStub.resolves(null);

      const location = await service.getLocationById(calendar, 'a1b2c3d4-9999-4000-8000-000000000099');

      expect(location).toBeNull();
      expect(findByPkStub.calledOnce).toBe(true);
    });

    it('should eager load content when fetching location by id', async () => {
      const calendar = new Calendar('cal-123', 'testcalendar');

      const locationEntity = LocationEntity.build({
        id: 'a1b2c3d4-0001-4000-8000-000000000001',
        calendar_id: 'cal-123',
        name: 'Washington Park',
      });

      const contentEntity = LocationContentEntity.build({
        id: 'content-1',
        location_id: 'a1b2c3d4-0001-4000-8000-000000000001',
        language: 'es',
        accessibility_info: 'Caminos accesibles.',
      });

      locationEntity.content = [contentEntity];

      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
      findByPkStub.resolves(locationEntity);

      const location = await service.getLocationById(calendar, 'a1b2c3d4-0001-4000-8000-000000000001');

      expect(location?.getLanguages()).toHaveLength(1);
      expect(location?.content('es').accessibilityInfo).toBe('Caminos accesibles.');
      expect(findByPkStub.firstCall.args[1]).toHaveProperty('include');
    });
  });

  describe('eager-loaded Spaces with eventCount', () => {
    /**
     * Build a minimal LocationSpaceEntity-like stub: real entity instance so
     * `toModel()` runs the production path, with a fake `getDataValue` that
     * surfaces the COUNT(events) value the production literal subquery would
     * have produced. Keeps the assertions focused on shape (eventCount lands
     * on the model, spaces[] is populated inline) without faking the entity
     * itself.
     */
    function buildSpaceWithEventCount(spaceId: string, placeId: string, eventCount: number): LocationSpaceEntity {
      const space = LocationSpaceEntity.build({ id: spaceId, place_id: placeId });
      const original = space.getDataValue.bind(space);
      space.getDataValue = ((key: any) => {
        if (key === 'eventCount') return eventCount;
        return original(key);
      }) as any;
      return space;
    }

    it('getLocationsForCalendar populates spaces[] inline with eventCount', async () => {
      const calendar = new Calendar('cal-123', 'testcalendar');
      const place = LocationEntity.build({
        id: 'a1b2c3d4-0001-4000-8000-000000000001',
        calendar_id: 'cal-123',
        name: 'Convention Center',
      });
      place.spaces = [
        buildSpaceWithEventCount('space-1', 'a1b2c3d4-0001-4000-8000-000000000001', 3),
        buildSpaceWithEventCount('space-2', 'a1b2c3d4-0001-4000-8000-000000000001', 0),
      ];

      const findAllStub = sandbox.stub(LocationEntity, 'findAll');
      findAllStub.resolves([place]);

      const locations = await service.getLocationsForCalendar(calendar);

      expect(locations).toHaveLength(1);
      expect(locations[0].spaces).toHaveLength(2);
      expect(locations[0].spaces[0].id).toBe('space-1');
      expect(locations[0].spaces[0].eventCount).toBe(3);
      expect(locations[0].spaces[1].id).toBe('space-2');
      expect(locations[0].spaces[1].eventCount).toBe(0);

      // Eager-load shape: include array carries the LocationSpaceEntity model
      // alongside the existing LocationContentEntity. The COUNT subquery rides
      // on the LocationSpaceEntity include's attributes.include.
      const opts = findAllStub.firstCall.args[0] as any;
      expect(opts.include).toBeDefined();
      const spaceInclude = opts.include.find((inc: any) => inc?.model === LocationSpaceEntity);
      expect(spaceInclude).toBeDefined();
      expect(spaceInclude.attributes?.include).toBeDefined();
      // The literal entry is shaped [literal, 'eventCount']
      const eventCountEntry = spaceInclude.attributes.include.find(
        (entry: any) => Array.isArray(entry) && entry[1] === 'eventCount',
      );
      expect(eventCountEntry).toBeDefined();
      // N+1 guard: separate:true must be set so Sequelize issues ONE
      // SELECT for all Spaces (joined via place_id IN-list) instead of one
      // SELECT per Place. Without this flag a calendar with 50 Places would
      // emit 51 queries on every list call.
      expect(spaceInclude.separate).toBe(true);
    });

    it('getLocationsForCalendar with no Spaces returns spaces=[] on each Place', async () => {
      const calendar = new Calendar('cal-123', 'testcalendar');
      const place = LocationEntity.build({
        id: 'a1b2c3d4-0001-4000-8000-000000000001',
        calendar_id: 'cal-123',
        name: 'Solo Place',
      });
      place.spaces = [];

      const findAllStub = sandbox.stub(LocationEntity, 'findAll');
      findAllStub.resolves([place]);

      const locations = await service.getLocationsForCalendar(calendar);

      expect(locations).toHaveLength(1);
      expect(locations[0].spaces).toEqual([]);
    });

    it('getLocationById populates spaces[] with eventCount', async () => {
      const calendar = new Calendar('cal-123', 'testcalendar');
      const place = LocationEntity.build({
        id: 'a1b2c3d4-0001-4000-8000-000000000001',
        calendar_id: 'cal-123',
        name: 'Convention Center',
      });
      place.spaces = [
        buildSpaceWithEventCount('space-A', 'a1b2c3d4-0001-4000-8000-000000000001', 5),
      ];

      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
      findByPkStub.resolves(place);

      const location = await service.getLocationById(calendar, 'a1b2c3d4-0001-4000-8000-000000000001');

      expect(location).not.toBeNull();
      expect(location!.spaces).toHaveLength(1);
      expect(location!.spaces[0].id).toBe('space-A');
      expect(location!.spaces[0].eventCount).toBe(5);

      // Eager-load shape: include block on findByPk carries the Space include
      // with the COUNT subquery.
      const opts = findByPkStub.firstCall.args[1] as any;
      expect(opts.include).toBeDefined();
      const spaceInclude = opts.include.find((inc: any) => inc?.model === LocationSpaceEntity);
      expect(spaceInclude).toBeDefined();
      expect(spaceInclude.attributes?.include).toBeDefined();
      // N+1 guard: separate:true keeps the eager-load shape consistent with
      // getLocationsForCalendar — Sequelize issues a single SELECT for the
      // Spaces of this Place rather than nesting them in the parent SELECT.
      expect(spaceInclude.separate).toBe(true);
    });

    it('getLocationById returns null without dereferencing spaces when calendar mismatched', async () => {
      const calendar = new Calendar('cal-123', 'testcalendar');
      const place = LocationEntity.build({
        id: 'a1b2c3d4-0001-4000-8000-000000000001',
        calendar_id: 'other-cal',
        name: 'Foreign Place',
      });

      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
      findByPkStub.resolves(place);

      const location = await service.getLocationById(calendar, 'a1b2c3d4-0001-4000-8000-000000000001');

      expect(location).toBeNull();
      expect(findByPkStub.calledOnce).toBe(true);
    });
  });

  describe('createLocation with content', () => {
    // Stub db.transaction so the create body runs inline with a fake tx handle.
    let txStub: sinon.SinonStub;
    beforeEach(() => {
      txStub = sandbox.stub(db, 'transaction').callsFake(async (callback: any) => {
        const fakeTx = { __brand: 'fake-tx' };
        return callback(fakeTx);
      });
    });

    /**
     * Helper: stub LocationEntity.findByPk so the post-write reload returns
     * a Place built from the supplied attributes. The id is whatever the
     * service generated and passed to findByPk.
     */
    function stubReload(calendarId: string, name: string, contents: { language: string; accessibility_info: string }[] = []) {
      const stub = sandbox.stub(LocationEntity, 'findByPk');
      stub.callsFake(async (id: any) => {
        const place = LocationEntity.build({ id, calendar_id: calendarId, name });
        place.content = contents.map(c =>
          LocationContentEntity.build({ location_id: id, language: c.language, accessibility_info: c.accessibility_info }),
        );
        place.spaces = [];
        return place;
      });
      return stub;
    }

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

      stubReload('cal-123', 'Community Center', [
        { language: 'en', accessibility_info: 'Elevator access to all floors.' },
      ]);

      const createdLocation = await service.createLocation(calendar, location);

      expect(createdLocation.id).toBeDefined();
      expect(createdLocation.name).toBe('Community Center');
      expect(createdLocation.getLanguages()).toHaveLength(1);
      expect(createdLocation.content('en').accessibilityInfo).toBe('Elevator access to all floors.');
      expect(saveStub.calledOnce).toBe(true);
      expect(contentSaveStub.calledOnce).toBe(true);
      expect(txStub.calledOnce).toBe(true);
    });

    it('should create location without content', async () => {
      const calendar = new Calendar('cal-123', 'testcalendar');

      const location = new EventLocation(
        undefined,
        'Simple Venue',
        '456 Oak St',
      );

      const saveStub = sandbox.stub(LocationEntity.prototype, 'save');

      stubReload('cal-123', 'Simple Venue');

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

      stubReload('cal-123', 'International Center', [
        { language: 'en', accessibility_info: 'Wheelchair ramps available.' },
        { language: 'es', accessibility_info: 'Rampas para sillas de ruedas disponibles.' },
      ]);

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

    // Regression: entity.id was set to a full URL instead of a UUID, causing PostgreSQL crash
    it('should generate UUID for location id', async () => {
      const calendar = new Calendar('cal-123', 'testcalendar');

      const location = new EventLocation(
        undefined,
        'Test Venue',
        '123 Test St',
      );

      const saveStub = sandbox.stub(LocationEntity.prototype, 'save');

      stubReload('cal-123', 'Test Venue');

      const createdLocation = await service.createLocation(calendar, location);

      expect(createdLocation.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(saveStub.calledOnce).toBe(true);
    });
  });
});
