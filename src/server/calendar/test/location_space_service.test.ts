import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Calendar } from '@/common/model/calendar';
import { EventLocationSpace } from '@/common/model/location';
import { LocationValidationError } from '@/common/exceptions/calendar';
import { LocationEntity } from '@/server/calendar/entity/location';
import { LocationSpaceEntity, LocationSpaceContentEntity } from '@/server/calendar/entity/location_space';
import { EventEntity } from '@/server/calendar/entity/event';
import LocationService from '@/server/calendar/service/locations';
import db from '@/server/common/entity/db';

describe('LocationService Spaces', () => {

  let sandbox: sinon.SinonSandbox;
  let service: LocationService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new LocationService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('createSpace', () => {

    it('should create a space with multilingual content and return populated model', async () => {
      const calendar = new Calendar('cal-1', 'testcal');

      // Place lookup returns a place that belongs to this calendar
      const placeEntity = LocationEntity.build({
        id: 'place-1',
        calendar_id: 'cal-1',
        name: 'Convention Center',
      });
      const findPlaceStub = sandbox.stub(LocationEntity, 'findByPk');
      findPlaceStub.resolves(placeEntity);

      // Stub LocationSpaceEntity.create to return a built entity with an id
      let createdSpaceId: string | undefined;
      const createSpaceStub = sandbox.stub(LocationSpaceEntity, 'create').callsFake(async (attrs: any) => {
        createdSpaceId = attrs.id;
        return LocationSpaceEntity.build({ id: attrs.id, place_id: attrs.place_id });
      });

      // Stub content row creation
      const createContentStub = sandbox.stub(LocationSpaceContentEntity, 'create').resolves();

      // Stub the final reload to return a space with content rows attached
      const findSpaceStub = sandbox.stub(LocationSpaceEntity, 'findByPk');
      findSpaceStub.callsFake(async (id: any) => {
        const fetched = LocationSpaceEntity.build({ id, place_id: 'place-1' });
        const enContent = LocationSpaceContentEntity.build({
          space_id: id,
          language: 'en',
          name: 'Pacific Room',
          accessibility_info: 'Hearing loop, 3rd floor',
        });
        const esContent = LocationSpaceContentEntity.build({
          space_id: id,
          language: 'es',
          name: 'Sala Pacífico',
          accessibility_info: 'Bucle magnético, tercer piso',
        });
        // Attach via the @HasMany association name
        (fetched as any).content = [enContent, esContent];
        return fetched;
      });

      const result = await service.createSpace(calendar, 'place-1', {
        en: { name: 'Pacific Room', accessibilityInfo: 'Hearing loop, 3rd floor' },
        es: { name: 'Sala Pacífico', accessibilityInfo: 'Bucle magnético, tercer piso' },
      });

      expect(result).toBeInstanceOf(EventLocationSpace);
      expect(result.id).toBeDefined();
      expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(result.placeId).toBe('place-1');
      expect(result.getLanguages().sort()).toEqual(['en', 'es']);
      expect(result.content('en').name).toBe('Pacific Room');
      expect(result.content('en').accessibilityInfo).toBe('Hearing loop, 3rd floor');
      expect(result.content('es').name).toBe('Sala Pacífico');
      expect(findPlaceStub.calledWith('place-1')).toBe(true);
      expect(createSpaceStub.called).toBe(true);
      expect(createContentStub.callCount).toBe(2);
      expect(createdSpaceId).toBeDefined();
    });

    it('should reject when Place does not exist', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const findPlaceStub = sandbox.stub(LocationEntity, 'findByPk');
      findPlaceStub.resolves(null);

      await expect(
        service.createSpace(calendar, 'missing-place', {
          en: { name: 'Some Space', accessibilityInfo: '' },
        }),
      ).rejects.toThrow(LocationValidationError);
      expect(findPlaceStub.called).toBe(true);
    });

    it('should reject when Place belongs to a different calendar', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const placeEntity = LocationEntity.build({
        id: 'place-1',
        calendar_id: 'other-cal',
        name: 'Other Calendar Place',
      });
      const findPlaceStub = sandbox.stub(LocationEntity, 'findByPk');
      findPlaceStub.resolves(placeEntity);

      const createSpaceStub = sandbox.stub(LocationSpaceEntity, 'create');

      await expect(
        service.createSpace(calendar, 'place-1', {
          en: { name: 'Some Space', accessibilityInfo: '' },
        }),
      ).rejects.toThrow(LocationValidationError);
      expect(findPlaceStub.called).toBe(true);
      expect(createSpaceStub.called).toBe(false);
    });
  });

  describe('getSpacesForPlace', () => {

    it('should return spaces for a place owned by the calendar', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const placeEntity = LocationEntity.build({
        id: 'place-1',
        calendar_id: 'cal-1',
        name: 'Convention Center',
      });
      const findPlaceStub = sandbox.stub(LocationEntity, 'findByPk');
      findPlaceStub.resolves(placeEntity);

      const space1 = LocationSpaceEntity.build({ id: 'space-1', place_id: 'place-1' });
      (space1 as any).content = [
        LocationSpaceContentEntity.build({
          space_id: 'space-1', language: 'en', name: 'Room A', accessibility_info: '',
        }),
      ];
      const space2 = LocationSpaceEntity.build({ id: 'space-2', place_id: 'place-1' });
      (space2 as any).content = [
        LocationSpaceContentEntity.build({
          space_id: 'space-2', language: 'en', name: 'Room B', accessibility_info: '',
        }),
      ];

      const findAllStub = sandbox.stub(LocationSpaceEntity, 'findAll');
      findAllStub.resolves([space1, space2]);

      const result = await service.getSpacesForPlace(calendar, 'place-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(EventLocationSpace);
      expect(result[0].id).toBe('space-1');
      expect(result[0].content('en').name).toBe('Room A');
      expect(result[1].id).toBe('space-2');
      expect(result[1].content('en').name).toBe('Room B');
      expect(findAllStub.calledOnce).toBe(true);
      expect((findAllStub.firstCall.args[0] as any).where).toEqual({ place_id: 'place-1' });
    });

    it('should return empty array when Place does not exist', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const findPlaceStub = sandbox.stub(LocationEntity, 'findByPk');
      findPlaceStub.resolves(null);

      const findAllStub = sandbox.stub(LocationSpaceEntity, 'findAll');

      const result = await service.getSpacesForPlace(calendar, 'missing-place');

      expect(result).toEqual([]);
      expect(findPlaceStub.called).toBe(true);
      expect(findAllStub.called).toBe(false);
    });

    it('should return empty array when Place belongs to a different calendar', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const placeEntity = LocationEntity.build({
        id: 'place-1',
        calendar_id: 'other-cal',
        name: 'Other Calendar Place',
      });
      const findPlaceStub = sandbox.stub(LocationEntity, 'findByPk');
      findPlaceStub.resolves(placeEntity);

      const findAllStub = sandbox.stub(LocationSpaceEntity, 'findAll');

      const result = await service.getSpacesForPlace(calendar, 'place-1');

      expect(result).toEqual([]);
      expect(findPlaceStub.called).toBe(true);
      expect(findAllStub.called).toBe(false);
    });
  });

  describe('updateSpace', () => {

    it('should replace content rows and return reloaded space when owned by calendar', async () => {
      const calendar = new Calendar('cal-1', 'testcal');

      // Build a Space with eager-loaded place that belongs to cal-1
      const placeEntity = LocationEntity.build({
        id: 'place-1',
        calendar_id: 'cal-1',
        name: 'Convention Center',
      });
      const spaceEntity = LocationSpaceEntity.build({
        id: 'space-1',
        place_id: 'place-1',
      });
      (spaceEntity as any).place = placeEntity;

      // findByPk is called twice: once to load the space (with place), once to reload after update
      const findSpaceStub = sandbox.stub(LocationSpaceEntity, 'findByPk');
      findSpaceStub.onFirstCall().resolves(spaceEntity);

      // The reload call returns the space with new content rows attached
      findSpaceStub.onSecondCall().callsFake(async () => {
        const reloaded = LocationSpaceEntity.build({ id: 'space-1', place_id: 'place-1' });
        (reloaded as any).content = [
          LocationSpaceContentEntity.build({
            space_id: 'space-1',
            language: 'en',
            name: 'Pacific Room',
            accessibility_info: 'Hearing loop',
          }),
          LocationSpaceContentEntity.build({
            space_id: 'space-1',
            language: 'fr',
            name: 'Salle Pacifique',
            accessibility_info: 'Boucle auditive',
          }),
        ];
        return reloaded;
      });

      const destroyStub = sandbox.stub(LocationSpaceContentEntity, 'destroy').resolves(2);
      const createContentStub = sandbox.stub(LocationSpaceContentEntity, 'create').resolves();

      const result = await service.updateSpace(calendar, 'space-1', {
        en: { name: 'Pacific Room', accessibilityInfo: 'Hearing loop' },
        fr: { name: 'Salle Pacifique', accessibilityInfo: 'Boucle auditive' },
      });

      expect(result).toBeInstanceOf(EventLocationSpace);
      expect(result!.id).toBe('space-1');
      expect(result!.placeId).toBe('place-1');
      expect(result!.getLanguages().sort()).toEqual(['en', 'fr']);
      expect(result!.content('en').name).toBe('Pacific Room');
      expect(result!.content('fr').name).toBe('Salle Pacifique');

      // Auth chain: findByPk used eager-load include for place
      expect(findSpaceStub.firstCall.args[1]).toBeDefined();
      const firstInclude = (findSpaceStub.firstCall.args[1] as any).include;
      expect(firstInclude).toBeDefined();

      // destroy-then-create pattern
      expect(destroyStub.calledOnce).toBe(true);
      expect((destroyStub.firstCall.args[0] as any).where).toEqual({ space_id: 'space-1' });
      expect(createContentStub.callCount).toBe(2);
    });

    it('should return null when Space does not exist', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const findSpaceStub = sandbox.stub(LocationSpaceEntity, 'findByPk');
      findSpaceStub.resolves(null);
      const destroyStub = sandbox.stub(LocationSpaceContentEntity, 'destroy');

      const result = await service.updateSpace(calendar, 'missing-space', {
        en: { name: 'Anything', accessibilityInfo: '' },
      });

      expect(result).toBeNull();
      expect(destroyStub.called).toBe(false);
    });

    it("should return null when Space's Place belongs to a different calendar", async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const placeEntity = LocationEntity.build({
        id: 'place-1',
        calendar_id: 'other-cal',
        name: 'Other Place',
      });
      const spaceEntity = LocationSpaceEntity.build({
        id: 'space-1',
        place_id: 'place-1',
      });
      (spaceEntity as any).place = placeEntity;

      const findSpaceStub = sandbox.stub(LocationSpaceEntity, 'findByPk');
      findSpaceStub.resolves(spaceEntity);
      const destroyStub = sandbox.stub(LocationSpaceContentEntity, 'destroy');

      const result = await service.updateSpace(calendar, 'space-1', {
        en: { name: 'Anything', accessibilityInfo: '' },
      });

      expect(result).toBeNull();
      expect(destroyStub.called).toBe(false);
    });

    it('should return null when Space has no loadable place association (authz failure, not crash)', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      // Space exists but place association did not load (e.g. orphaned/missing)
      const spaceEntity = LocationSpaceEntity.build({
        id: 'space-1',
        place_id: 'place-1',
      });
      // Note: no (spaceEntity as any).place assigned
      const findSpaceStub = sandbox.stub(LocationSpaceEntity, 'findByPk');
      findSpaceStub.resolves(spaceEntity);
      const destroyStub = sandbox.stub(LocationSpaceContentEntity, 'destroy');

      const result = await service.updateSpace(calendar, 'space-1', {
        en: { name: 'Anything', accessibilityInfo: '' },
      });

      expect(result).toBeNull();
      expect(destroyStub.called).toBe(false);
    });
  });

  describe('deleteSpace', () => {

    // Stub db.transaction so the cascade body runs inline with a fake tx handle.
    // Mirrors the pattern in location_service.test.ts deleteLocation suite — the
    // wrapper executes the callback synchronously so per-call stubs can observe
    // the threaded transaction option.
    let txStub: sinon.SinonStub;
    beforeEach(() => {
      txStub = sandbox.stub(db, 'transaction').callsFake(async (callback: any) => {
        const fakeTx = { __brand: 'fake-tx' };
        return callback(fakeTx);
      });
    });

    it('should delete content + space and nullify event.space_id while leaving location_id intact', async () => {
      const calendar = new Calendar('cal-1', 'testcal');

      const placeEntity = LocationEntity.build({
        id: 'place-1',
        calendar_id: 'cal-1',
        name: 'Convention Center',
      });
      const spaceEntity = LocationSpaceEntity.build({
        id: 'space-1',
        place_id: 'place-1',
      });
      (spaceEntity as any).place = placeEntity;

      const findSpaceStub = sandbox.stub(LocationSpaceEntity, 'findByPk');
      findSpaceStub.resolves(spaceEntity);

      const eventUpdateStub = sandbox.stub(EventEntity, 'update').resolves([3]);
      const contentDestroyStub = sandbox.stub(LocationSpaceContentEntity, 'destroy').resolves(2);
      const spaceDestroyStub = sandbox.stub(spaceEntity, 'destroy').resolves();

      const result = await service.deleteSpace(calendar, 'space-1');

      expect(result).toBe(true);
      expect(txStub.calledOnce).toBe(true);

      // Auth chain: findByPk used eager-load include for place
      expect(findSpaceStub.firstCall.args[1]).toBeDefined();
      const firstInclude = (findSpaceStub.firstCall.args[1] as any).include;
      expect(firstInclude).toBeDefined();

      // Event side effect: only space_id nullified, location_id NOT touched
      expect(eventUpdateStub.calledOnce).toBe(true);
      const updateValues = eventUpdateStub.firstCall.args[0] as any;
      expect(updateValues).toEqual({ space_id: null });
      expect('location_id' in updateValues).toBe(false);
      expect((eventUpdateStub.firstCall.args[1] as any).where).toEqual({ space_id: 'space-1' });

      expect(contentDestroyStub.calledOnce).toBe(true);
      expect((contentDestroyStub.firstCall.args[0] as any).where).toEqual({ space_id: 'space-1' });
      expect(spaceDestroyStub.calledOnce).toBe(true);
    });

    it('runs the entire cascade inside a single db.transaction', async () => {
      const calendar = new Calendar('cal-1', 'testcal');

      const placeEntity = LocationEntity.build({
        id: 'place-1',
        calendar_id: 'cal-1',
        name: 'Convention Center',
      });
      const spaceEntity = LocationSpaceEntity.build({
        id: 'space-1',
        place_id: 'place-1',
      });
      (spaceEntity as any).place = placeEntity;

      sandbox.stub(LocationSpaceEntity, 'findByPk').resolves(spaceEntity);
      const eventUpdateStub = sandbox.stub(EventEntity, 'update').resolves([0]);
      const contentDestroyStub = sandbox.stub(LocationSpaceContentEntity, 'destroy').resolves(0);
      const spaceDestroyStub = sandbox.stub(spaceEntity, 'destroy').resolves();

      const result = await service.deleteSpace(calendar, 'space-1');

      expect(result).toBe(true);
      // Single transaction wraps the cascade
      expect(txStub.calledOnce).toBe(true);

      // Every write inside the cascade must thread the same tx handle through
      // its options object. The handle is the value our stub passed to the
      // db.transaction callback (recovered here from the EventEntity.update
      // first call).
      const eventOpts = eventUpdateStub.firstCall.args[1] as any;
      expect(eventOpts.transaction).toBeDefined();
      const tx = eventOpts.transaction;

      expect((contentDestroyStub.firstCall.args[0] as any).transaction).toBe(tx);
      expect(spaceDestroyStub.firstCall.args[0]).toEqual({ transaction: tx });
    });

    it('should return false when Space does not exist; no side effects', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const findSpaceStub = sandbox.stub(LocationSpaceEntity, 'findByPk');
      findSpaceStub.resolves(null);

      const eventUpdateStub = sandbox.stub(EventEntity, 'update');
      const contentDestroyStub = sandbox.stub(LocationSpaceContentEntity, 'destroy');

      const result = await service.deleteSpace(calendar, 'missing-space');

      expect(result).toBe(false);
      expect(eventUpdateStub.called).toBe(false);
      expect(contentDestroyStub.called).toBe(false);
    });

    it("should return false when Space's Place belongs to a different calendar; no rows affected", async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const placeEntity = LocationEntity.build({
        id: 'place-1',
        calendar_id: 'other-cal',
        name: 'Other Place',
      });
      const spaceEntity = LocationSpaceEntity.build({
        id: 'space-1',
        place_id: 'place-1',
      });
      (spaceEntity as any).place = placeEntity;

      const findSpaceStub = sandbox.stub(LocationSpaceEntity, 'findByPk');
      findSpaceStub.resolves(spaceEntity);

      const eventUpdateStub = sandbox.stub(EventEntity, 'update');
      const contentDestroyStub = sandbox.stub(LocationSpaceContentEntity, 'destroy');
      const spaceDestroyStub = sandbox.stub(spaceEntity, 'destroy');

      const result = await service.deleteSpace(calendar, 'space-1');

      expect(result).toBe(false);
      expect(eventUpdateStub.called).toBe(false);
      expect(contentDestroyStub.called).toBe(false);
      expect(spaceDestroyStub.called).toBe(false);
    });

    it('should return false when Space has no loadable place association (authz failure, not crash)', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const spaceEntity = LocationSpaceEntity.build({
        id: 'space-1',
        place_id: 'place-1',
      });
      // Note: no (spaceEntity as any).place assigned

      const findSpaceStub = sandbox.stub(LocationSpaceEntity, 'findByPk');
      findSpaceStub.resolves(spaceEntity);

      const eventUpdateStub = sandbox.stub(EventEntity, 'update');
      const contentDestroyStub = sandbox.stub(LocationSpaceContentEntity, 'destroy');

      const result = await service.deleteSpace(calendar, 'space-1');

      expect(result).toBe(false);
      expect(eventUpdateStub.called).toBe(false);
      expect(contentDestroyStub.called).toBe(false);
    });
  });
});
