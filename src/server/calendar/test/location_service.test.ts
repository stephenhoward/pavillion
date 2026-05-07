import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Calendar } from '@/common/model/calendar';
import { EventLocation, EventLocationContent, EventLocationSpace, EventLocationSpaceContent } from '@/common/model/location';
import { InvalidClientIdError, SpaceHijackError } from '@/common/exceptions/calendar';
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

    // Stub db.transaction so the create body runs inline with a fake tx handle.
    // Mirrors the deleteLocation suite — the wrapper executes the callback
    // synchronously so per-call stubs can observe the threaded tx option.
    let txStub: sinon.SinonStub;
    beforeEach(() => {
      txStub = sandbox.stub(db, 'transaction').callsFake(async (callback: any) => {
        const fakeTx = { __brand: 'fake-tx' };
        return callback(fakeTx);
      });
    });

    it('should create a location', async () => {
      let saveStub = sandbox.stub(LocationEntity.prototype, 'save');
      let eventSpy = sandbox.spy(LocationEntity, 'fromModel');

      // Post-write reload: findByPk returns a freshly-built place entity
      // whose id matches the one the service generated. The service calls
      // toModel() on it to produce the response.
      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk').callsFake(async (id: any) => {
        return LocationEntity.build({ id, calendar_id: 'testCalendarId', name: 'testName' });
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
      expect(txStub.calledOnce).toBe(true);
      expect(findByPkStub.called).toBe(true);
    });

    it('inserts nested Spaces and echoes clientId back on the response (pv-0pht)', async () => {
      const calendar = new Calendar('cal-1', 'testcal');

      sandbox.stub(LocationEntity.prototype, 'save').resolves();
      const spaceCreateStub = sandbox.stub(LocationSpaceEntity, 'create').callsFake(async (attrs: any) => {
        return LocationSpaceEntity.build({ id: attrs.id, place_id: attrs.place_id });
      });
      const spaceContentCreateStub = sandbox.stub(LocationSpaceContentEntity, 'create').resolves();

      // Capture the place id from the LocationEntity save side-effect so the
      // reload stub can return a Place whose Space rows carry the same ids
      // we just inserted.
      let createdSpaceIds: string[] = [];
      spaceCreateStub.callsFake(async (attrs: any) => {
        createdSpaceIds.push(attrs.id);
        return LocationSpaceEntity.build({ id: attrs.id, place_id: attrs.place_id });
      });

      sandbox.stub(LocationEntity, 'findByPk').callsFake(async (id: any) => {
        const place = LocationEntity.build({ id, calendar_id: 'cal-1', name: 'Convention Center' });
        place.spaces = createdSpaceIds.map(spaceId =>
          LocationSpaceEntity.build({ id: spaceId, place_id: id }),
        );
        return place;
      });

      // Build the input model with two staged Spaces, each carrying a clientId.
      const input = new EventLocation('', 'Convention Center');
      const stagedA = new EventLocationSpace();
      stagedA.clientId = '11111111-1111-4111-8111-111111111111';
      stagedA.addContent(new EventLocationSpaceContent('en', 'Pacific Room', 'Hearing loop'));
      const stagedB = new EventLocationSpace();
      stagedB.clientId = '22222222-2222-4222-8222-222222222222';
      stagedB.addContent(new EventLocationSpaceContent('en', 'Atlantic Room', ''));
      input.spaces = [stagedA, stagedB];

      const result = await service.createLocation(calendar, input);

      // Two Space rows + their content were inserted under the transaction
      expect(spaceCreateStub.callCount).toBe(2);
      expect(spaceContentCreateStub.callCount).toBe(2);
      // Every write threaded the same tx handle
      const tx = (spaceCreateStub.firstCall.args[1] as any).transaction;
      expect(tx).toBeDefined();
      expect((spaceCreateStub.secondCall.args[1] as any).transaction).toBe(tx);
      expect((spaceContentCreateStub.firstCall.args[1] as any).transaction).toBe(tx);

      // Response carries the inserted Spaces with clientId echoes
      expect(result.spaces).toHaveLength(2);
      const echoed = result.spaces.map(s => s.clientId).sort();
      expect(echoed).toEqual([
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ]);
    });

    it('rejects malformed clientId with InvalidClientIdError before any write', async () => {
      const calendar = new Calendar('cal-1', 'testcal');

      const saveStub = sandbox.stub(LocationEntity.prototype, 'save');
      const spaceCreateStub = sandbox.stub(LocationSpaceEntity, 'create');

      const input = new EventLocation('', 'Convention Center');
      const bad = new EventLocationSpace();
      bad.clientId = 'not-a-uuid';
      bad.addContent(new EventLocationSpaceContent('en', 'Pacific Room', ''));
      input.spaces = [bad];

      await expect(service.createLocation(calendar, input))
        .rejects.toThrow(InvalidClientIdError);

      // Nothing should have been written — the validation gate runs before
      // the transaction opens.
      expect(saveStub.called).toBe(false);
      expect(spaceCreateStub.called).toBe(false);
      expect(txStub.called).toBe(false);
    });
  });

  describe('updateLocation', () => {

    // Stub db.transaction so the update body runs inline with a fake tx handle.
    let txStub: sinon.SinonStub;
    beforeEach(() => {
      txStub = sandbox.stub(db, 'transaction').callsFake(async (callback: any) => {
        const fakeTx = { __brand: 'fake-tx' };
        return callback(fakeTx);
      });
    });

    /**
     * Helper: stub LocationEntity.findByPk so it returns the supplied auth
     * entity on the first call (the auth gate) and a "reloaded" entity on
     * later calls (the post-write reload). The reloaded entity inherits the
     * id/calendar_id/name from the auth entity unless overridden.
     */
    function stubFindByPk(authEntity: LocationEntity, reloadedSpaces: LocationSpaceEntity[] = []) {
      const stub = sandbox.stub(LocationEntity, 'findByPk');
      stub.onFirstCall().resolves(authEntity);
      stub.onCall(1).callsFake(async (id: any) => {
        const reloaded = LocationEntity.build({
          id,
          calendar_id: authEntity.calendar_id,
          name: authEntity.name,
        });
        reloaded.spaces = reloadedSpaces;
        return reloaded;
      });
      return stub;
    }

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

      stubFindByPk(existingEntity);

      const updateStub = sandbox.stub(existingEntity, 'update').resolves(existingEntity);
      sandbox.stub(LocationContentEntity, 'destroy').resolves(0);
      sandbox.stub(LocationSpaceEntity, 'findAll').resolves([]);

      const locationData = new EventLocation('loc-1', 'New Name', '456 New St', 'New City', 'NC', '11111', 'US');
      const result = await service.updateLocation(calendar, 'loc-1', locationData);

      expect(result).toBeDefined();
      expect(result!.name).toBe('Old Name'); // reloaded shape from stub
      expect(updateStub.called).toBe(true);
      expect(txStub.calledOnce).toBe(true);
    });

    it('should return null if location not found', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
      findByPkStub.resolves(null);

      const locationData = new EventLocation('', 'New Name');
      const result = await service.updateLocation(calendar, 'nonexistent', locationData);

      expect(result).toBeNull();
      expect(txStub.called).toBe(false);
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
      expect(txStub.called).toBe(false);
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
      expect(txStub.called).toBe(false);
    });

    it('should update content for existing languages', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const existingEntity = LocationEntity.build({
        id: 'loc-1',
        calendar_id: 'cal-1',
        name: 'Venue',
      });

      stubFindByPk(existingEntity);
      sandbox.stub(existingEntity, 'update').resolves(existingEntity);

      const destroyStub = sandbox.stub(LocationContentEntity, 'destroy').resolves(1);
      sandbox.stub(LocationContentEntity.prototype, 'save').resolves();
      sandbox.stub(LocationSpaceEntity, 'findAll').resolves([]);

      const locationData = new EventLocation('loc-1', 'Venue');
      locationData.addContent(new EventLocationContent('en', 'Wheelchair accessible'));

      const result = await service.updateLocation(calendar, 'loc-1', locationData);

      expect(result).toBeDefined();
      expect(destroyStub.called).toBe(true);
      // destroy ran under the transaction
      expect((destroyStub.firstCall.args[0] as any).transaction).toBeDefined();
    });

    describe('snapshot diff for spaces (pv-0pht)', () => {
      it('updates existing Space content when incoming id matches a row scoped to place_id', async () => {
        const calendar = new Calendar('cal-1', 'testcal');
        const existingEntity = LocationEntity.build({ id: 'loc-1', calendar_id: 'cal-1', name: 'Venue' });
        stubFindByPk(existingEntity);
        sandbox.stub(existingEntity, 'update').resolves(existingEntity);
        sandbox.stub(LocationContentEntity, 'destroy').resolves(0);

        // One existing Space scoped to this Place
        const existingSpace = LocationSpaceEntity.build({ id: 'space-1', place_id: 'loc-1' });
        const findAllStub = sandbox.stub(LocationSpaceEntity, 'findAll').resolves([existingSpace]);

        const contentDestroyStub = sandbox.stub(LocationSpaceContentEntity, 'destroy').resolves(1);
        const contentCreateStub = sandbox.stub(LocationSpaceContentEntity, 'create').resolves();
        const spaceCreateStub = sandbox.stub(LocationSpaceEntity, 'create');
        const spaceDestroyStub = sandbox.stub(LocationSpaceEntity, 'destroy');

        // Incoming snapshot echoes the existing Space id with new content
        const locationData = new EventLocation('loc-1', 'Venue');
        const incoming = new EventLocationSpace('space-1', 'loc-1');
        incoming.addContent(new EventLocationSpaceContent('en', 'Updated Room', 'Updated info'));
        locationData.spaces = [incoming];

        await service.updateLocation(calendar, 'loc-1', locationData);

        // findAll scoped by place_id (NOT calendar.id) — security boundary
        expect(findAllStub.calledOnce).toBe(true);
        expect((findAllStub.firstCall.args[0] as any).where).toEqual({ place_id: 'loc-1' });

        // Content was replaced (destroy + create), not the Space row
        expect(contentDestroyStub.calledOnce).toBe(true);
        expect((contentDestroyStub.firstCall.args[0] as any).where).toEqual({ space_id: 'space-1' });
        expect(contentCreateStub.calledOnce).toBe(true);
        expect(spaceCreateStub.called).toBe(false);
        expect(spaceDestroyStub.called).toBe(false);
      });

      it('inserts new Space when incoming has clientId and no id; echoes clientId on response', async () => {
        const calendar = new Calendar('cal-1', 'testcal');
        const existingEntity = LocationEntity.build({ id: 'loc-1', calendar_id: 'cal-1', name: 'Venue' });

        // Capture the new Space id so the reload stub can return a Place
        // whose Space rows match what was just inserted.
        let createdSpaceId: string | undefined;
        const spaceCreateStub = sandbox.stub(LocationSpaceEntity, 'create').callsFake(async (attrs: any) => {
          createdSpaceId = attrs.id;
          return LocationSpaceEntity.build({ id: attrs.id, place_id: attrs.place_id });
        });

        const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
        findByPkStub.onFirstCall().resolves(existingEntity);
        findByPkStub.onCall(1).callsFake(async (id: any) => {
          const reloaded = LocationEntity.build({ id, calendar_id: 'cal-1', name: 'Venue' });
          reloaded.spaces = createdSpaceId
            ? [LocationSpaceEntity.build({ id: createdSpaceId, place_id: id })]
            : [];
          return reloaded;
        });

        sandbox.stub(existingEntity, 'update').resolves(existingEntity);
        sandbox.stub(LocationContentEntity, 'destroy').resolves(0);
        sandbox.stub(LocationSpaceEntity, 'findAll').resolves([]);
        sandbox.stub(LocationSpaceContentEntity, 'create').resolves();

        const locationData = new EventLocation('loc-1', 'Venue');
        const staged = new EventLocationSpace();
        staged.clientId = '33333333-3333-4333-8333-333333333333';
        staged.addContent(new EventLocationSpaceContent('en', 'New Room', ''));
        locationData.spaces = [staged];

        const result = await service.updateLocation(calendar, 'loc-1', locationData);

        // Space row was inserted under the transaction
        expect(spaceCreateStub.calledOnce).toBe(true);
        expect(createdSpaceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

        // Response carries the inserted Space with clientId echo
        expect(result).not.toBeNull();
        expect(result!.spaces).toHaveLength(1);
        expect(result!.spaces[0].clientId).toBe('33333333-3333-4333-8333-333333333333');
      });

      it('destroys existing Space rows missing from the incoming snapshot', async () => {
        const calendar = new Calendar('cal-1', 'testcal');
        const existingEntity = LocationEntity.build({ id: 'loc-1', calendar_id: 'cal-1', name: 'Venue' });
        stubFindByPk(existingEntity);
        sandbox.stub(existingEntity, 'update').resolves(existingEntity);
        sandbox.stub(LocationContentEntity, 'destroy').resolves(0);

        // Two existing Spaces; incoming snapshot keeps only the first
        const keep = LocationSpaceEntity.build({ id: 'keep-1', place_id: 'loc-1' });
        const drop = LocationSpaceEntity.build({ id: 'drop-1', place_id: 'loc-1' });
        sandbox.stub(LocationSpaceEntity, 'findAll').resolves([keep, drop]);

        const spaceContentDestroyStub = sandbox.stub(LocationSpaceContentEntity, 'destroy').resolves(0);
        sandbox.stub(LocationSpaceContentEntity, 'create').resolves();
        const spaceDestroyStub = sandbox.stub(LocationSpaceEntity, 'destroy').resolves(1);

        const locationData = new EventLocation('loc-1', 'Venue');
        const survivor = new EventLocationSpace('keep-1', 'loc-1');
        survivor.addContent(new EventLocationSpaceContent('en', 'Keep Room', ''));
        locationData.spaces = [survivor];

        await service.updateLocation(calendar, 'loc-1', locationData);

        // The dropped Space was destroyed via id IN-list; FK SET NULL on
        // events.space_id handles the event-side null automatically (covered
        // by integration tier in pv-0pht.10).
        expect(spaceDestroyStub.calledOnce).toBe(true);
        expect((spaceDestroyStub.firstCall.args[0] as any).where).toEqual({ id: ['drop-1'] });

        // Content rows for the dropped Space were also swept by the IN-list
        // destroy. Two `LocationSpaceContentEntity.destroy` calls fire in
        // this scenario: one inside `_replaceSpaceContent` for the kept
        // survivor (`space_id: 'keep-1'`), and one in the destroy branch
        // for the dropped row (`space_id: ['drop-1']`). Find the IN-list
        // call by shape — that is the destroy-branch sweep we want to lock
        // down. (testing-auditor pv-0pht.3 follow-up.)
        const dropContentCall = spaceContentDestroyStub.getCalls().find(
          (call: any) => Array.isArray((call.args[0] as any).where?.space_id),
        );
        expect(dropContentCall).toBeDefined();
        expect((dropContentCall!.args[0] as any).where).toEqual({ space_id: ['drop-1'] });
      });

      it('rejects sibling-Place hijack with SpaceHijackError before any write to the diff', async () => {
        const calendar = new Calendar('cal-1', 'testcal');
        const existingEntity = LocationEntity.build({ id: 'loc-1', calendar_id: 'cal-1', name: 'Venue' });
        const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
        findByPkStub.onFirstCall().resolves(existingEntity);

        sandbox.stub(existingEntity, 'update').resolves(existingEntity);
        sandbox.stub(LocationContentEntity, 'destroy').resolves(0);

        // Existing set scoped to place_id contains only space-A; the incoming
        // payload references space-FROM-OTHER-PLACE which is owned by a
        // sibling Place on the same calendar.
        const ownSpace = LocationSpaceEntity.build({ id: 'space-A', place_id: 'loc-1' });
        sandbox.stub(LocationSpaceEntity, 'findAll').resolves([ownSpace]);

        const contentDestroyStub = sandbox.stub(LocationSpaceContentEntity, 'destroy');
        const contentCreateStub = sandbox.stub(LocationSpaceContentEntity, 'create');
        const spaceCreateStub = sandbox.stub(LocationSpaceEntity, 'create');
        const spaceDestroyStub = sandbox.stub(LocationSpaceEntity, 'destroy');

        const locationData = new EventLocation('loc-1', 'Venue');
        const hijack = new EventLocationSpace('space-FROM-OTHER-PLACE', 'loc-1');
        hijack.addContent(new EventLocationSpaceContent('en', 'Hijack Room', ''));
        locationData.spaces = [hijack];

        await expect(service.updateLocation(calendar, 'loc-1', locationData))
          .rejects.toThrow(SpaceHijackError);

        // No diff write reached the database after rejection — the hijack
        // throw aborts the transaction body before any Space-side write runs.
        expect(spaceCreateStub.called).toBe(false);
        expect(spaceDestroyStub.called).toBe(false);
        expect(contentDestroyStub.called).toBe(false);
        expect(contentCreateStub.called).toBe(false);
      });

      it('rejects malformed clientId with InvalidClientIdError before opening the transaction', async () => {
        const calendar = new Calendar('cal-1', 'testcal');
        const existingEntity = LocationEntity.build({ id: 'loc-1', calendar_id: 'cal-1', name: 'Venue' });
        const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');
        findByPkStub.resolves(existingEntity);

        const updateStub = sandbox.stub(existingEntity, 'update');
        const contentDestroyStub = sandbox.stub(LocationContentEntity, 'destroy');
        const findAllStub = sandbox.stub(LocationSpaceEntity, 'findAll');

        const locationData = new EventLocation('loc-1', 'Venue');
        const bad = new EventLocationSpace();
        bad.clientId = 'not-a-uuid';
        bad.addContent(new EventLocationSpaceContent('en', 'Bad Room', ''));
        locationData.spaces = [bad];

        await expect(service.updateLocation(calendar, 'loc-1', locationData))
          .rejects.toThrow(InvalidClientIdError);

        // Validation gate runs before db.transaction is called
        expect(txStub.called).toBe(false);
        expect(updateStub.called).toBe(false);
        expect(contentDestroyStub.called).toBe(false);
        expect(findAllStub.called).toBe(false);
      });
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

  describe('reassignEvents (pv-0pht.5 service tier)', () => {
    // Stub db.transaction so the body runs inline with a fake tx handle. This
    // mirrors the deleteLocation/updateLocation suites — the wrapper executes
    // the callback synchronously so per-call stubs can observe the threaded
    // tx option on the EventEntity.update call.
    let txStub: sinon.SinonStub;
    beforeEach(() => {
      txStub = sandbox.stub(db, 'transaction').callsFake(async (callback: any) => {
        const fakeTx = { __brand: 'fake-tx' };
        return callback(fakeTx);
      });
    });

    const fromSpaceId = '11111111-1111-4111-8111-111111111111';
    const toSpaceId = '22222222-2222-4222-8222-222222222222';

    it('happy path: returns { count: N, placeFound: true, toSpaceValid: true } and threads tx through EventEntity.update', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const place = LocationEntity.build({ id: 'place-1', calendar_id: 'cal-1', name: 'Convention Center' });
      const toSpace = LocationSpaceEntity.build({ id: toSpaceId, place_id: 'place-1' });

      sandbox.stub(LocationEntity, 'findByPk').resolves(place);
      sandbox.stub(LocationSpaceEntity, 'findOne').resolves(toSpace);
      const eventUpdateStub = sandbox.stub(EventEntity, 'update').resolves([4]);

      const result = await service.reassignEvents(calendar, 'place-1', fromSpaceId, toSpaceId);

      expect(result).toEqual({ count: 4, placeFound: true, toSpaceValid: true });
      expect(txStub.calledOnce).toBe(true);

      // Transaction threading: the EventEntity.update call must carry the
      // transaction handle from db.transaction's callback.
      expect(eventUpdateStub.calledOnce).toBe(true);
      const updateOpts = eventUpdateStub.firstCall.args[1] as any;
      expect(updateOpts.transaction).toBeDefined();

      // WHERE-clause scoping is the security boundary. Asserting both columns
      // pins down the structural fence: events outside this Place are never
      // touched, even if the supplied fromSpaceId is malicious.
      expect(updateOpts.where).toEqual({ location_id: 'place-1', space_id: fromSpaceId });

      // SET clause: only space_id is updated (location_id stays put — the
      // event remains attached to the Place).
      expect(eventUpdateStub.firstCall.args[0]).toEqual({ space_id: toSpaceId });
    });

    it('out-of-Place fromSpaceId: returns { count: 0, placeFound: true, toSpaceValid: true } (idempotent no-op)', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const place = LocationEntity.build({ id: 'place-1', calendar_id: 'cal-1', name: 'Convention Center' });
      const toSpace = LocationSpaceEntity.build({ id: toSpaceId, place_id: 'place-1' });

      sandbox.stub(LocationEntity, 'findByPk').resolves(place);
      sandbox.stub(LocationSpaceEntity, 'findOne').resolves(toSpace);
      // The UPDATE matches zero rows because fromSpaceId is no longer on this
      // Place (e.g. it was already destroyed by a prior snapshot diff). The
      // service treats this as a documented no-op for retry idempotency.
      const eventUpdateStub = sandbox.stub(EventEntity, 'update').resolves([0]);

      const result = await service.reassignEvents(calendar, 'place-1', fromSpaceId, toSpaceId);

      expect(result).toEqual({ count: 0, placeFound: true, toSpaceValid: true });
      // The UPDATE still ran — the service does NOT pre-validate fromSpaceId
      // against the Place's Space set (the WHERE-clause is the safety fence).
      expect(eventUpdateStub.calledOnce).toBe(true);
      expect((eventUpdateStub.firstCall.args[1] as any).where).toEqual({
        location_id: 'place-1',
        space_id: fromSpaceId,
      });
    });

    it('toSpaceId not on this Place: returns { count: 0, placeFound: true, toSpaceValid: false } and skips the UPDATE', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const place = LocationEntity.build({ id: 'place-1', calendar_id: 'cal-1', name: 'Convention Center' });

      sandbox.stub(LocationEntity, 'findByPk').resolves(place);
      // findOne returns null when (id, place_id) does not match — captures both
      // "Space does not exist" and "Space exists but on a sibling Place".
      const findOneStub = sandbox.stub(LocationSpaceEntity, 'findOne').resolves(null);
      const eventUpdateStub = sandbox.stub(EventEntity, 'update');

      const result = await service.reassignEvents(calendar, 'place-1', fromSpaceId, toSpaceId);

      expect(result).toEqual({ count: 0, placeFound: true, toSpaceValid: false });
      // findOne scoped by (id, place_id) — security boundary: a Space owned
      // by a sibling Place on the same calendar is rejected.
      expect(findOneStub.calledOnce).toBe(true);
      expect((findOneStub.firstCall.args[0] as any).where).toEqual({
        id: toSpaceId,
        place_id: 'place-1',
      });
      // No UPDATE runs when validation fails — and no transaction opens.
      expect(eventUpdateStub.called).toBe(false);
      expect(txStub.called).toBe(false);
    });

    it('place not found: returns { count: 0, placeFound: false, toSpaceValid: false } and short-circuits', async () => {
      const calendar = new Calendar('cal-1', 'testcal');

      sandbox.stub(LocationEntity, 'findByPk').resolves(null);
      const findOneStub = sandbox.stub(LocationSpaceEntity, 'findOne');
      const eventUpdateStub = sandbox.stub(EventEntity, 'update');

      const result = await service.reassignEvents(calendar, 'missing-place', fromSpaceId, toSpaceId);

      expect(result).toEqual({ count: 0, placeFound: false, toSpaceValid: false });
      // Short-circuit before the toSpaceId lookup or any UPDATE.
      expect(findOneStub.called).toBe(false);
      expect(eventUpdateStub.called).toBe(false);
      expect(txStub.called).toBe(false);
    });

    it('place on a different calendar: returns { count: 0, placeFound: false, toSpaceValid: false } (calendar boundary)', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const foreignPlace = LocationEntity.build({
        id: 'place-1',
        calendar_id: 'other-cal',
        name: 'Foreign Place',
      });

      sandbox.stub(LocationEntity, 'findByPk').resolves(foreignPlace);
      const findOneStub = sandbox.stub(LocationSpaceEntity, 'findOne');
      const eventUpdateStub = sandbox.stub(EventEntity, 'update');

      const result = await service.reassignEvents(calendar, 'place-1', fromSpaceId, toSpaceId);

      expect(result).toEqual({ count: 0, placeFound: false, toSpaceValid: false });
      // The calendar boundary is a stricter gate than the Space boundary; the
      // service rejects before consulting the Space set.
      expect(findOneStub.called).toBe(false);
      expect(eventUpdateStub.called).toBe(false);
      expect(txStub.called).toBe(false);
    });
  });
});
