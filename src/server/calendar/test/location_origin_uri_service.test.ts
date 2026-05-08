import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Calendar } from '@/common/model/calendar';
import { EventLocation, EventLocationContent, EventLocationSpace } from '@/common/model/location';
import { LocationEntity, LocationContentEntity } from '@/server/calendar/entity/location';
import { LocationSpaceEntity, LocationSpaceContentEntity } from '@/server/calendar/entity/location_space';
import LocationService from '@/server/calendar/service/locations';

describe('LocationService origin_uri dedup helpers', () => {

  let sandbox: sinon.SinonSandbox;
  let service: LocationService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new LocationService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('findOrCreatePlaceByOriginUri', () => {

    it('returns the existing Place when one already exists for (calendar_id, origin_uri)', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const originUri = 'https://example.org/places/community-center';

      const existing = LocationEntity.build({
        id: 'place-existing',
        calendar_id: 'cal-1',
        name: 'Community Center',
        address: '1 Main St',
        city: 'Townsville',
        state: '',
        postal_code: '',
        country: '',
        origin_uri: originUri,
      });
      (existing as any).content = [
        LocationContentEntity.build({
          location_id: 'place-existing',
          language: 'en',
          accessibility_info: 'Wheelchair accessible',
        }),
      ];

      const findOneStub = sandbox.stub(LocationEntity, 'findOne').resolves(existing);
      const buildStub = sandbox.stub(LocationEntity, 'build');
      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk');

      const data = new EventLocation(undefined, 'Community Center', '1 Main St', 'Townsville');
      const result = await service.findOrCreatePlaceByOriginUri(calendar, originUri, data);

      expect(result).toBeInstanceOf(EventLocation);
      expect(result.id).toBe('place-existing');
      expect(result.originUri).toBe(originUri);
      expect(result.content('en').accessibilityInfo).toBe('Wheelchair accessible');

      // Lookup must be scoped to (calendar_id, origin_uri)
      expect(findOneStub.calledOnce).toBe(true);
      expect((findOneStub.firstCall.args[0] as any).where).toEqual({
        calendar_id: 'cal-1',
        origin_uri: originUri,
      });

      // No create branch invoked
      expect(buildStub.called).toBe(false);
      expect(findByPkStub.called).toBe(false);
    });

    it('creates a new Place with origin_uri set and content rows when no match exists', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const originUri = 'https://example.org/places/new-spot';

      const findOneStub = sandbox.stub(LocationEntity, 'findOne').resolves(null);

      // Capture what gets persisted
      let savedEntity: LocationEntity | undefined;
      const saveStub = sandbox.stub(LocationEntity.prototype, 'save').callsFake(async function (this: LocationEntity) {
        savedEntity = this;
        return this;
      });

      const contentSaveStub = sandbox.stub(LocationContentEntity.prototype, 'save').resolves();

      // Final reload returns a populated entity
      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk').callsFake(async (id: any) => {
        const reloaded = LocationEntity.build({
          id,
          calendar_id: 'cal-1',
          name: 'New Spot',
          address: '',
          city: '',
          state: '',
          postal_code: '',
          country: '',
          origin_uri: originUri,
        });
        (reloaded as any).content = [
          LocationContentEntity.build({
            location_id: id,
            language: 'en',
            accessibility_info: 'Step-free entrance',
          }),
        ];
        return reloaded;
      });

      const data = new EventLocation(undefined, 'New Spot');
      const enContent = new EventLocationContent('en', 'Step-free entrance');
      data.addContent(enContent);

      const result = await service.findOrCreatePlaceByOriginUri(calendar, originUri, data);

      // Result is the populated reload
      expect(result).toBeInstanceOf(EventLocation);
      expect(result.id).toBeDefined();
      expect(result.originUri).toBe(originUri);
      expect(result.content('en').accessibilityInfo).toBe('Step-free entrance');

      // Lookup scoped properly
      expect(findOneStub.calledOnce).toBe(true);
      expect((findOneStub.firstCall.args[0] as any).where).toEqual({
        calendar_id: 'cal-1',
        origin_uri: originUri,
      });

      // Persistence happened with origin_uri + calendar_id
      expect(saveStub.calledOnce).toBe(true);
      expect(savedEntity).toBeDefined();
      expect(savedEntity!.calendar_id).toBe('cal-1');
      expect(savedEntity!.origin_uri).toBe(originUri);
      expect(savedEntity!.name).toBe('New Spot');
      expect(savedEntity!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

      // Content row written
      expect(contentSaveStub.calledOnce).toBe(true);

      // Reload fetched
      expect(findByPkStub.calledOnce).toBe(true);
    });

    it('calling twice with the same originUri returns the same row (dedup)', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const originUri = 'https://example.org/places/repeat';

      // First call: no existing record, create one with id 'place-X'.
      // Second call: findOne returns the just-created row.
      const findOneStub = sandbox.stub(LocationEntity, 'findOne');

      let createdId: string | undefined;
      const saveStub = sandbox.stub(LocationEntity.prototype, 'save').callsFake(async function (this: LocationEntity) {
        createdId = this.id;
        return this;
      });
      sandbox.stub(LocationContentEntity.prototype, 'save').resolves();

      const findByPkStub = sandbox.stub(LocationEntity, 'findByPk').callsFake(async (id: any) => {
        const reloaded = LocationEntity.build({
          id,
          calendar_id: 'cal-1',
          name: 'Repeat Place',
          address: '',
          city: '',
          state: '',
          postal_code: '',
          country: '',
          origin_uri: originUri,
        });
        (reloaded as any).content = [];
        return reloaded;
      });

      const data = new EventLocation(undefined, 'Repeat Place');

      // First call: nothing exists
      findOneStub.onFirstCall().resolves(null);
      const first = await service.findOrCreatePlaceByOriginUri(calendar, originUri, data);

      // Second call: findOne returns the previously persisted record
      findOneStub.onSecondCall().callsFake(async () => {
        const existing = LocationEntity.build({
          id: createdId!,
          calendar_id: 'cal-1',
          name: 'Repeat Place',
          origin_uri: originUri,
        });
        (existing as any).content = [];
        return existing;
      });

      const second = await service.findOrCreatePlaceByOriginUri(calendar, originUri, data);

      expect(first.id).toBe(createdId);
      expect(second.id).toBe(createdId);
      expect(first.id).toBe(second.id);

      // Only one save (i.e. one row written across the two calls)
      expect(saveStub.calledOnce).toBe(true);

      // findByPk only invoked once (during the create branch reload)
      expect(findByPkStub.calledOnce).toBe(true);
    });
  });

  describe('findOrCreateSpaceByOriginUri', () => {

    it('returns the existing Space when one already exists for (place_id, origin_uri)', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const place = new EventLocation('place-1', 'Convention Center');
      const originUri = 'https://example.org/spaces/room-a';

      const existing = LocationSpaceEntity.build({
        id: 'space-existing',
        place_id: 'place-1',
        origin_uri: originUri,
      });
      (existing as any).content = [
        LocationSpaceContentEntity.build({
          space_id: 'space-existing',
          language: 'en',
          name: 'Room A',
          accessibility_info: 'Hearing loop',
        }),
      ];

      const findOneStub = sandbox.stub(LocationSpaceEntity, 'findOne').resolves(existing);
      const createStub = sandbox.stub(LocationSpaceEntity, 'create');
      const contentCreateStub = sandbox.stub(LocationSpaceContentEntity, 'create');

      const result = await service.findOrCreateSpaceByOriginUri(calendar, place, originUri, {
        en: { name: 'Room A', accessibilityInfo: 'Hearing loop' },
      });

      expect(result).toBeInstanceOf(EventLocationSpace);
      expect(result.id).toBe('space-existing');
      expect(result.placeId).toBe('place-1');
      expect(result.originUri).toBe(originUri);
      expect(result.content('en').name).toBe('Room A');

      // Lookup scoped to (place_id, origin_uri)
      expect(findOneStub.calledOnce).toBe(true);
      expect((findOneStub.firstCall.args[0] as any).where).toEqual({
        place_id: 'place-1',
        origin_uri: originUri,
      });

      // No create branch invoked
      expect(createStub.called).toBe(false);
      expect(contentCreateStub.called).toBe(false);
    });

    it('creates a new Space with origin_uri set and content rows when no match exists', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const place = new EventLocation('place-1', 'Convention Center');
      const originUri = 'https://example.org/spaces/new-room';

      const findOneStub = sandbox.stub(LocationSpaceEntity, 'findOne').resolves(null);

      let createdAttrs: any;
      const createStub = sandbox.stub(LocationSpaceEntity, 'create').callsFake(async (attrs: any) => {
        createdAttrs = attrs;
        return LocationSpaceEntity.build({
          id: attrs.id,
          place_id: attrs.place_id,
          origin_uri: attrs.origin_uri,
        });
      });

      const contentCreateStub = sandbox.stub(LocationSpaceContentEntity, 'create').resolves();

      // Reload returns the populated space
      const findByPkStub = sandbox.stub(LocationSpaceEntity, 'findByPk').callsFake(async (id: any) => {
        const reloaded = LocationSpaceEntity.build({
          id,
          place_id: 'place-1',
          origin_uri: originUri,
        });
        (reloaded as any).content = [
          LocationSpaceContentEntity.build({
            space_id: id,
            language: 'en',
            name: 'New Room',
            accessibility_info: 'Step-free',
          }),
          LocationSpaceContentEntity.build({
            space_id: id,
            language: 'fr',
            name: 'Nouvelle Salle',
            accessibility_info: 'Sans marche',
          }),
        ];
        return reloaded;
      });

      const result = await service.findOrCreateSpaceByOriginUri(calendar, place, originUri, {
        en: { name: 'New Room', accessibilityInfo: 'Step-free' },
        fr: { name: 'Nouvelle Salle', accessibilityInfo: 'Sans marche' },
      });

      expect(result).toBeInstanceOf(EventLocationSpace);
      expect(result.id).toBeDefined();
      expect(result.placeId).toBe('place-1');
      expect(result.originUri).toBe(originUri);
      expect(result.getLanguages().sort()).toEqual(['en', 'fr']);
      expect(result.content('en').name).toBe('New Room');
      expect(result.content('fr').name).toBe('Nouvelle Salle');

      // Lookup scoped to (place_id, origin_uri)
      expect(findOneStub.calledOnce).toBe(true);
      expect((findOneStub.firstCall.args[0] as any).where).toEqual({
        place_id: 'place-1',
        origin_uri: originUri,
      });

      // Created with origin_uri set
      expect(createStub.calledOnce).toBe(true);
      expect(createdAttrs.place_id).toBe('place-1');
      expect(createdAttrs.origin_uri).toBe(originUri);
      expect(createdAttrs.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

      // One content row per language
      expect(contentCreateStub.callCount).toBe(2);

      // Reload fetched the space with content
      expect(findByPkStub.calledOnce).toBe(true);
    });

    it('calling twice with the same originUri returns the same row (dedup)', async () => {
      const calendar = new Calendar('cal-1', 'testcal');
      const place = new EventLocation('place-1', 'Convention Center');
      const originUri = 'https://example.org/spaces/repeat-room';

      const findOneStub = sandbox.stub(LocationSpaceEntity, 'findOne');

      let createdId: string | undefined;
      const createStub = sandbox.stub(LocationSpaceEntity, 'create').callsFake(async (attrs: any) => {
        createdId = attrs.id;
        return LocationSpaceEntity.build({
          id: attrs.id,
          place_id: attrs.place_id,
          origin_uri: attrs.origin_uri,
        });
      });
      sandbox.stub(LocationSpaceContentEntity, 'create').resolves();

      sandbox.stub(LocationSpaceEntity, 'findByPk').callsFake(async (id: any) => {
        const reloaded = LocationSpaceEntity.build({
          id,
          place_id: 'place-1',
          origin_uri: originUri,
        });
        (reloaded as any).content = [];
        return reloaded;
      });

      // First call: no match
      findOneStub.onFirstCall().resolves(null);
      const first = await service.findOrCreateSpaceByOriginUri(calendar, place, originUri, {
        en: { name: 'Repeat Room', accessibilityInfo: '' },
      });

      // Second call: findOne returns the persisted row
      findOneStub.onSecondCall().callsFake(async () => {
        const existing = LocationSpaceEntity.build({
          id: createdId!,
          place_id: 'place-1',
          origin_uri: originUri,
        });
        (existing as any).content = [];
        return existing;
      });

      const second = await service.findOrCreateSpaceByOriginUri(calendar, place, originUri, {
        en: { name: 'Repeat Room', accessibilityInfo: '' },
      });

      expect(first.id).toBe(createdId);
      expect(second.id).toBe(createdId);
      expect(first.id).toBe(second.id);

      // Only one Space row created across two calls
      expect(createStub.calledOnce).toBe(true);
    });
  });
});
