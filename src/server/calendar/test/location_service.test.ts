import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Account } from '@/common/model/account';
import { EventLocation } from '@/common/model/location';
import { LocationEntity } from '@/server/calendar/entity/location';
import LocationService from '@/server/calendar/service/locations';

describe('findLocation', () => {

  let sandbox = sinon.createSandbox();

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return a location by id', async () => {
    let findLocationStub = sandbox.stub(LocationEntity, 'findByPk');
    let account = new Account('acctid', 'testme', 'testme');

    findLocationStub.resolves(LocationEntity.build({
      accountId: account.id,
      name: 'testLocation',
    }));

    let location = await LocationService.findLocation(
      account,
      new EventLocation('id', 'testLocation'),
    );

    expect(location).toBeDefined();
    expect(findLocationStub.called).toBe(true);
  });

  it('account id mismatch', async () => {
    let findLocationStub = sandbox.stub(LocationEntity, 'findByPk');
    let account = new Account('acctid', 'testme', 'testme');

    findLocationStub.resolves(LocationEntity.build({
      accountId: 'someOtherAccountId',
      name: 'testLocation',
    }));

    let location = await LocationService.findLocation(
      account,
      new EventLocation('id', 'testLocation'),
    );

    expect(location).toBeNull();
    expect(findLocationStub.called).toBe(true);
  });

  it('no location with that id', async () => {
    let findLocationStub = sandbox.stub(LocationEntity, 'findByPk');
    findLocationStub.resolves(undefined);

    let location = await LocationService.findLocation(
      new Account('id', 'testme', 'testme'),
      new EventLocation('id', 'testLocation'),
    );

    expect(location).toBeNull();
    expect(findLocationStub.called).toBe(true);
  });

  it('match by attributes', async () => {
    let findLocationStub = sandbox.stub(LocationEntity, 'findOne');
    findLocationStub.resolves(LocationEntity.build({ name: 'testLocation' }));

    let location = await LocationService.findLocation(
      new Account('id', 'testme', 'testme'),
      new EventLocation('', 'testLocation'),
    );

    expect(location).toBeDefined();
    expect(findLocationStub.called).toBe(true);
  });

  it('no matches by attribute', async () => {
    let findLocationStub = sandbox.stub(LocationEntity, 'findOne');
    findLocationStub.resolves(undefined);

    let location = await LocationService.findLocation(
      new Account('id', 'testme', 'testme'),
      new EventLocation('', 'testLocation'),
    );

    expect(location).toBeNull();
    expect(findLocationStub.called).toBe(true);
  });

  describe('createLocation', () => {

    let sandbox = sinon.createSandbox();

    afterEach(() => {
      sandbox.restore();
    });

    it('should create a location', async () => {
      let saveStub = sandbox.stub(LocationEntity.prototype, 'save');
      let eventSpy = sandbox.spy(LocationEntity, 'fromModel');

      let location = await LocationService.createLocation(
        new Account('testAccountId', 'testme', 'testme'),
        new EventLocation('', 'testName'),
      );

      expect(location.id).toBeDefined();
      expect(location.id).toMatch(/^https:\/\/pavillion.dev\/places\/[a-z0-9-]+$/);
      expect(eventSpy.returnValues[0].account_id).toBe('testAccountId');
      expect(saveStub.called).toBe(true);
    });

  });

});
