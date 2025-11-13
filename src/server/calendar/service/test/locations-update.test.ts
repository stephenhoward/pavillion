import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventLocation } from '@/common/model/location';
import LocationService from '@/server/calendar/service/locations';
import { Calendar } from '@/common/model/calendar';
import { LocationEntity } from '@/server/calendar/entity/location';

describe('LocationService - Event Update Location Handling (LOC-003)', () => {
  let sandbox: sinon.SinonSandbox;
  let locationService: LocationService;
  let testCalendar: Calendar;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    locationService = new LocationService();
    testCalendar = new Calendar('test-calendar-id', 'test-calendar');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should find existing location when location id is provided', async () => {
    // Create an existing location with an ID
    const existingLocation = new EventLocation(
      'https://localhost:3000/places/existing-location-id',
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

    // Mock LocationEntity.findOne to return null (location not found by field matching)
    const findOneStub = sandbox.stub(LocationEntity, 'findOne').resolves(null);

    // Mock LocationEntity.fromModel and save
    const mockEntity = {
      id: '',
      calendar_id: testCalendar.id,
      save: sandbox.stub().resolves(),
      toModel: () => new EventLocation(
        'https://localhost:3000/places/new-location-id',
        locationParams.name,
        locationParams.address,
        locationParams.city,
        locationParams.state,
        locationParams.postalCode,
        locationParams.country,
      ),
    };
    sandbox.stub(LocationEntity, 'fromModel').returns(mockEntity as any);

    const result = await locationService.findOrCreateLocation(testCalendar, locationParams);

    // Verify findOne was called (because id was missing)
    expect(findOneStub.calledOnce).toBe(true);

    // Verify a new location was created with a generated URL ID
    expect(result.id).toContain('https://');
    expect(result.id).toContain('/places/');
  });

  it('should reuse existing location when updating event with same location data', async () => {
    // Simulate updating an event where the location data hasn't changed
    // but the id is included in the params
    const existingLocation = new EventLocation(
      'https://localhost:3000/places/existing-id',
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
      id: '', // Empty ID because it's a different location
      name: 'New Venue',
      address: '456 Oak Ave',
      city: 'Chicago',
      state: 'IL',
      postalCode: '60601',
      country: 'USA',
    };

    // Mock findOne to return null (new location doesn't exist yet)
    sandbox.stub(LocationEntity, 'findOne').resolves(null);

    // Mock creation of new location
    const mockEntity = {
      id: '',
      calendar_id: testCalendar.id,
      save: sandbox.stub().resolves(),
      toModel: () => new EventLocation(
        'https://localhost:3000/places/new-venue-id',
        newLocationParams.name,
        newLocationParams.address,
        newLocationParams.city,
        newLocationParams.state,
        newLocationParams.postalCode,
        newLocationParams.country,
      ),
    };
    sandbox.stub(LocationEntity, 'fromModel').returns(mockEntity as any);

    const result = await locationService.findOrCreateLocation(testCalendar, newLocationParams);

    // Verify a new location was created
    expect(result.name).toBe('New Venue');
    expect(result.address).toBe('456 Oak Ave');
    expect(result.id).toContain('https://');
  });
});
