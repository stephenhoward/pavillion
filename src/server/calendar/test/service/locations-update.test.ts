import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventLocation } from '@/common/model/location';
import LocationService from '@/server/calendar/service/locations';
import { Calendar } from '@/common/model/calendar';
import { LocationEntity } from '@/server/calendar/entity/location';
import db from '@/server/common/entity/db';

describe('LocationService - Event Update Location Handling (LOC-003)', () => {
  let sandbox: sinon.SinonSandbox;
  let locationService: LocationService;
  let testCalendar: Calendar;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    locationService = new LocationService();
    testCalendar = new Calendar('test-calendar-id', 'test-calendar');

    // createLocation now wraps its writes in db.transaction (pv-0pht.3) — stub
    // the wrapper so the body runs inline with a fake tx handle. Tests that
    // do not exercise createLocation are unaffected (the stub is a no-op).
    sandbox.stub(db, 'transaction').callsFake(async (callback: any) => {
      const fakeTx = { __brand: 'fake-tx' };
      return callback(fakeTx);
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should find existing location when location id is provided', async () => {
    // Create an existing location with an ID
    const existingLocation = new EventLocation(
      'b2c3d4e5-0001-4000-8000-000000000001',
      'Test Venue',
      '123 Main St',
      'Springfield',
      'IL',
      '62701',
      'USA',
    );

    // Mock LocationEntity.findByPk to return the existing location
    const mockEntity = {
      id: existingLocation.id,
      calendar_id: testCalendar.id,
      name: existingLocation.name,
      address: existingLocation.address,
      city: existingLocation.city,
      state: existingLocation.state,
      postal_code: existingLocation.postalCode,
      country: existingLocation.country,
      toModel: () => existingLocation,
    };
    const findByPkStub = sandbox.stub(LocationEntity, 'findByPk').resolves(mockEntity as any);
    const createLocationSpy = sandbox.spy(locationService, 'createLocation');

    // Call findOrCreateLocation with location data that includes an ID
    const locationParams = {
      id: existingLocation.id,
      name: existingLocation.name,
      address: existingLocation.address,
      city: existingLocation.city,
      state: existingLocation.state,
      postalCode: existingLocation.postalCode,
      country: existingLocation.country,
    };

    const result = await locationService.findOrCreateLocation(testCalendar, locationParams);

    // Verify findByPk was called with the correct ID
    expect(findByPkStub.calledOnce).toBe(true);
    expect(findByPkStub.firstCall.args[0]).toBe(existingLocation.id);

    // Verify createLocation was NOT called (existing location was found)
    expect(createLocationSpy.called).toBe(false);

    // Verify the returned location matches the existing location
    expect(result.id).toBe(existingLocation.id);
    expect(result.name).toBe(existingLocation.name);
  });

  it('should create new location when location id is missing during update', async () => {
    // Simulate event update where toObject() omits the id field
    const locationParams = {
      // id is missing! This is the bug scenario
      name: 'Test Venue',
      address: '123 Main St',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62701',
      country: 'USA',
    };

    // findByPk is now used by createLocation for the post-write reload
    // (pv-0pht.3) — return a built entity matching the generated id so the
    // reload-and-toModel path produces a valid response model.
    sandbox.stub(LocationEntity, 'findByPk').callsFake(async (id: any) => {
      if (!id) return null;
      return LocationEntity.build({
        id,
        calendar_id: testCalendar.id,
        name: locationParams.name,
        address: locationParams.address,
        city: locationParams.city,
        state: locationParams.state,
        postal_code: locationParams.postalCode,
        country: locationParams.country,
      });
    });

    // Mock LocationEntity.findOne to return null (location not found by field matching)
    const findOneStub = sandbox.stub(LocationEntity, 'findOne').resolves(null);

    // Mock LocationEntity.fromModel and save
    const mockEntity = {
      id: '',
      calendar_id: testCalendar.id,
      save: sandbox.stub().resolves(),
    };
    sandbox.stub(LocationEntity, 'fromModel').returns(mockEntity as any);

    const result = await locationService.findOrCreateLocation(testCalendar, locationParams);

    // Verify findOne was called (because id was empty/falsy)
    expect(findOneStub.calledOnce).toBe(true);

    // Verify a new location was created with a generated UUID
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('should reuse existing location when updating event with same location data', async () => {
    // Simulate updating an event where the location data hasn't changed
    // but the id is included in the params
    const existingLocation = new EventLocation(
      'b2c3d4e5-0003-4000-8000-000000000003',
      'Test Venue',
      '123 Main St',
      'Springfield',
      'IL',
      '62701',
      'USA',
    );

    // Mock LocationEntity.findByPk to return the existing location
    const mockEntity = {
      id: existingLocation.id,
      calendar_id: testCalendar.id,
      name: existingLocation.name,
      address: existingLocation.address,
      city: existingLocation.city,
      state: existingLocation.state,
      postal_code: existingLocation.postalCode,
      country: existingLocation.country,
      toModel: () => existingLocation,
    };
    const findByPkStub = sandbox.stub(LocationEntity, 'findByPk').resolves(mockEntity as any);

    // Include id in location params (this is what should happen after the fix)
    const locationParams = {
      id: existingLocation.id,  // ID is present
      name: existingLocation.name,
      address: existingLocation.address,
      city: existingLocation.city,
      state: existingLocation.state,
      postalCode: existingLocation.postalCode,
      country: existingLocation.country,
    };

    const result = await locationService.findOrCreateLocation(testCalendar, locationParams);

    // Verify the same location ID is returned (no new location created)
    expect(result.id).toBe(existingLocation.id);
    expect(findByPkStub.calledOnce).toBe(true);
  });

  it('should handle updating event location from one venue to another', async () => {
    // Simulate changing the location of an event from one venue to another
    const newLocationParams = {
      // Omit id property entirely - this is a new location
      name: 'New Venue',
      address: '456 Oak Ave',
      city: 'Chicago',
      state: 'IL',
      postalCode: '60601',
      country: 'USA',
    };

    // findByPk is now used by createLocation for the post-write reload
    // (pv-0pht.3). Return null on empty-id auth-style lookups; return a
    // built entity for the post-write reload using the generated UUID.
    sandbox.stub(LocationEntity, 'findByPk').callsFake(async (id: any) => {
      if (!id) return null;
      return LocationEntity.build({
        id,
        calendar_id: testCalendar.id,
        name: newLocationParams.name,
        address: newLocationParams.address,
        city: newLocationParams.city,
        state: newLocationParams.state,
        postal_code: newLocationParams.postalCode,
        country: newLocationParams.country,
      });
    });

    // Mock findOne to return null (new location doesn't exist yet)
    sandbox.stub(LocationEntity, 'findOne').resolves(null);

    // Mock creation of new location
    const mockEntity = {
      id: '',
      calendar_id: testCalendar.id,
      save: sandbox.stub().resolves(),
    };
    sandbox.stub(LocationEntity, 'fromModel').returns(mockEntity as any);

    const result = await locationService.findOrCreateLocation(testCalendar, newLocationParams);

    // Verify a new location was created
    expect(result.name).toBe('New Venue');
    expect(result.address).toBe('456 Oak Ave');
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
