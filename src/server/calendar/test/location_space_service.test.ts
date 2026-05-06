import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Calendar } from '@/common/model/calendar';
import { EventLocationSpace } from '@/common/model/location';
import { LocationValidationError } from '@/common/exceptions/calendar';
import { LocationEntity } from '@/server/calendar/entity/location';
import { LocationSpaceEntity, LocationSpaceContentEntity } from '@/server/calendar/entity/location_space';
import LocationService from '@/server/calendar/service/locations';

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
});
