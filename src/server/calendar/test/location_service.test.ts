import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Calendar } from '@/common/model/calendar';
import { EventLocation } from '@/common/model/location';
import { LocationEntity } from '@/server/calendar/entity/location';
import LocationService from '@/server/calendar/service/locations';

describe('findLocation', () => {

  let sandbox = sinon.createSandbox();
  let service: LocationService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new LocationService();
  });

  afterEach(() => {
    sandbox.restore();
  });

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

  describe('createLocation', () => {

    let sandbox = sinon.createSandbox();
    let service: LocationService;

    beforeEach(() => {
      service = new LocationService();
    });

    afterEach(() => {
      sandbox.restore();
    });

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

});
