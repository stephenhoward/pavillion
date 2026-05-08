/**
 * Tests for EventService.addRemoteEvent / updateRemoteEvent dedup-by-origin_uri
 * routing.
 *
 * The inbox path normalizes inbound `pavillion:place` / `pavillion:space`
 * extensions into `eventParams.location.originUri` and
 * `eventParams.space.originUri`. EventService is responsible for branching:
 *
 *   - originUri present  → LocationsService.findOrCreate{Place,Space}ByOriginUri
 *                         (dedup: two inbound events sharing the same source
 *                          identity collapse to one row per calendar)
 *   - originUri absent   → existing flat-create path (Mobilizon/Mastodon/Gancio)
 *
 * The Space ↔ Place invariant (validateSpaceMatchesPlace) is also enforced
 * on this path.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Calendar } from '@/common/model/calendar';
import { EventLocation } from '@/common/model/location';
import { EventEntity } from '@/server/calendar/entity/event';
import { LocationSpaceEntity } from '@/server/calendar/entity/location_space';
import { SpaceLocationMismatchError } from '@/common/exceptions/calendar';
import EventService from '@/server/calendar/service/events';

describe('EventService.addRemoteEvent — origin_uri dedup routing', () => {
  let service: EventService;
  let sandbox: sinon.SinonSandbox;
  const cal = new Calendar('cal-1', 'testcal');

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new EventService(new EventEmitter());
    // EventEntity.save is patched so persistence doesn't require a real DB.
    sandbox.stub(EventEntity.prototype, 'save').resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('routes Place to findOrCreatePlaceByOriginUri when origin_uri is present', async () => {
    const originUri = 'https://remote.example/calendars/x/places/abc';
    const resolvedPlace = new EventLocation('place-1', 'Town Hall');
    resolvedPlace.originUri = originUri;

    const findOrCreateByOriginStub = sandbox.stub(service['locationService'], 'findOrCreatePlaceByOriginUri').resolves(resolvedPlace);
    const flatFindOrCreateStub = sandbox.stub(service['locationService'], 'findOrCreateLocation');

    const eventSpy = sandbox.spy(EventEntity, 'fromModel');

    await service.addRemoteEvent(cal, {
      id: '11111111-1111-4111-8111-111111111111',
      location: {
        name: 'Town Hall',
        originUri,
      },
    });

    expect(findOrCreateByOriginStub.calledOnce).toBe(true);
    const callArgs = findOrCreateByOriginStub.firstCall.args;
    expect(callArgs[0]).toBe(cal);
    expect(callArgs[1]).toBe(originUri);

    // Flat path was not invoked.
    expect(flatFindOrCreateStub.called).toBe(false);

    // location_id ends up persisted to the resolved Place's id.
    const built = eventSpy.returnValues[0];
    expect(built.location_id).toBe('place-1');
  });

  it('falls back to flat findOrCreateLocation when origin_uri is absent (Mobilizon/Mastodon/Gancio)', async () => {
    const flatPlace = new EventLocation('place-flat', 'Plain Venue');
    const flatFindOrCreateStub = sandbox.stub(service['locationService'], 'findOrCreateLocation').resolves(flatPlace);
    const findOrCreateByOriginStub = sandbox.stub(service['locationService'], 'findOrCreatePlaceByOriginUri');

    const eventSpy = sandbox.spy(EventEntity, 'fromModel');

    await service.addRemoteEvent(cal, {
      id: '22222222-2222-4222-8222-222222222222',
      location: {
        name: 'Plain Venue',
        // no originUri
      },
    });

    expect(flatFindOrCreateStub.calledOnce).toBe(true);
    expect(findOrCreateByOriginStub.called).toBe(false);

    const built = eventSpy.returnValues[0];
    expect(built.location_id).toBe('place-flat');
  });

  it('routes Space to findOrCreateSpaceByOriginUri when both place and space carry origin_uri', async () => {
    const placeOriginUri = 'https://remote.example/calendars/x/places/abc';
    const spaceOriginUri = 'https://remote.example/calendars/x/places/abc/spaces/main-hall';

    const resolvedPlace = new EventLocation('place-1', 'Convention Center');
    resolvedPlace.originUri = placeOriginUri;
    sandbox.stub(service['locationService'], 'findOrCreatePlaceByOriginUri').resolves(resolvedPlace);

    const findOrCreateSpaceByOriginStub = sandbox.stub(service['locationService'], 'findOrCreateSpaceByOriginUri');
    findOrCreateSpaceByOriginStub.resolves({
      id: 'space-1',
      placeId: 'place-1',
    } as any);

    // The helper re-loads the space via findByPk so place_id is readable.
    sandbox.stub(LocationSpaceEntity, 'findByPk').resolves(LocationSpaceEntity.build({
      id: 'space-1',
      place_id: 'place-1',
      origin_uri: spaceOriginUri,
    }) as unknown as LocationSpaceEntity);

    const eventSpy = sandbox.spy(EventEntity, 'fromModel');

    await service.addRemoteEvent(cal, {
      id: '33333333-3333-4333-8333-333333333333',
      location: {
        name: 'Convention Center',
        originUri: placeOriginUri,
      },
      space: {
        originUri: spaceOriginUri,
        content: {
          en: { name: 'Main Hall', accessibilityInfo: 'Hearing loop' },
        },
      },
    });

    expect(findOrCreateSpaceByOriginStub.calledOnce).toBe(true);
    const args = findOrCreateSpaceByOriginStub.firstCall.args;
    expect(args[0]).toBe(cal);
    expect(args[1]).toBe(resolvedPlace);
    expect(args[2]).toBe(spaceOriginUri);
    expect(args[3]).toEqual({
      en: { name: 'Main Hall', accessibilityInfo: 'Hearing loop' },
    });

    // space_id ends up persisted on the EventEntity post-fromModel mutation.
    const built = eventSpy.returnValues[0];
    expect(built.space_id).toBe('space-1');
  });

  it('does not call space helper when no Place was resolved (defensive guard)', async () => {
    // Place flat-path returns null is impossible (findOrCreateLocation always
    // returns), so the only realistic gap here is no `location` at all but a
    // spurious `space` arrives. The space must be ignored without throwing.
    const findOrCreateSpaceByOriginStub = sandbox.stub(service['locationService'], 'findOrCreateSpaceByOriginUri');

    await service.addRemoteEvent(cal, {
      id: '44444444-4444-4444-8444-444444444444',
      // no location
      space: {
        originUri: 'https://remote.example/calendars/x/places/abc/spaces/orphan',
      },
    });

    expect(findOrCreateSpaceByOriginStub.called).toBe(false);
  });

  it('enforces validateSpaceMatchesPlace post-resolution', async () => {
    const placeOriginUri = 'https://remote.example/calendars/x/places/abc';
    const spaceOriginUri = 'https://remote.example/calendars/x/places/abc/spaces/main-hall';

    const resolvedPlace = new EventLocation('place-correct', 'Right Place');
    resolvedPlace.originUri = placeOriginUri;
    sandbox.stub(service['locationService'], 'findOrCreatePlaceByOriginUri').resolves(resolvedPlace);

    sandbox.stub(service['locationService'], 'findOrCreateSpaceByOriginUri').resolves({
      id: 'space-mismatch',
      placeId: 'place-OTHER',
    } as any);

    // findByPk first call: re-load resolved space (within
    // resolveRemoteLocationAndSpace). Returns a space whose place_id is some
    // OTHER place — simulating a hostile / racing sender.
    // findByPk second call: validateSpaceMatchesPlace's own lookup.
    const findByPkStub = sandbox.stub(LocationSpaceEntity, 'findByPk');
    findByPkStub.onFirstCall().resolves(LocationSpaceEntity.build({
      id: 'space-mismatch',
      place_id: 'place-OTHER',
      origin_uri: spaceOriginUri,
    }) as unknown as LocationSpaceEntity);
    findByPkStub.onSecondCall().resolves(LocationSpaceEntity.build({
      id: 'space-mismatch',
      place_id: 'place-OTHER',
    }) as unknown as LocationSpaceEntity);

    let thrown: unknown = null;
    try {
      await service.addRemoteEvent(cal, {
        id: '55555555-5555-4555-8555-555555555555',
        location: {
          name: 'Right Place',
          originUri: placeOriginUri,
        },
        space: {
          originUri: spaceOriginUri,
        },
      });
    }
    catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(SpaceLocationMismatchError);
    const err = thrown as SpaceLocationMismatchError;
    expect(err.spaceId).toBe('space-mismatch');
    expect(err.expectedPlaceId).toBe('place-correct');
    expect(err.actualPlaceId).toBe('place-OTHER');
  });

  it('two events with the same place origin_uri reach the dedup helper for both calls', async () => {
    // This proves the *routing* — that both events take the dedup path.
    // The dedup *behavior* (single LocationEntity row) is asserted in
    // location_origin_uri_service.test.ts; here we only prove the wiring.
    const originUri = 'https://remote.example/calendars/x/places/shared';
    const resolvedPlace = new EventLocation('place-shared', 'Shared Venue');
    resolvedPlace.originUri = originUri;

    const findOrCreateByOriginStub = sandbox.stub(service['locationService'], 'findOrCreatePlaceByOriginUri').resolves(resolvedPlace);

    await service.addRemoteEvent(cal, {
      id: '66666666-6666-4666-8666-666666666666',
      location: { name: 'Shared Venue', originUri },
    });
    await service.addRemoteEvent(cal, {
      id: '77777777-7777-4777-8777-777777777777',
      location: { name: 'Shared Venue', originUri },
    });

    expect(findOrCreateByOriginStub.callCount).toBe(2);
    // Both calls used the same (calendar, originUri) tuple so the helper's
    // own (calendar_id, origin_uri) WHERE clause produces a single row.
    expect(findOrCreateByOriginStub.firstCall.args[0]).toBe(cal);
    expect(findOrCreateByOriginStub.firstCall.args[1]).toBe(originUri);
    expect(findOrCreateByOriginStub.secondCall.args[0]).toBe(cal);
    expect(findOrCreateByOriginStub.secondCall.args[1]).toBe(originUri);
  });
});

describe('EventService.updateRemoteEvent — origin_uri dedup routing', () => {
  let service: EventService;
  let sandbox: sinon.SinonSandbox;
  const cal = new Calendar('cal-1', 'testcal');

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new EventService(new EventEmitter());
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('routes Place to findOrCreatePlaceByOriginUri when origin_uri is present on update', async () => {
    const originUri = 'https://remote.example/calendars/x/places/abc';
    const resolvedPlace = new EventLocation('place-1', 'Town Hall');
    resolvedPlace.originUri = originUri;

    const eventEntity = EventEntity.build({
      id: '11111111-1111-4111-8111-111111111111',
      calendar_id: null,
    });
    sandbox.stub(EventEntity, 'findByPk').resolves(eventEntity);
    sandbox.stub(EventEntity.prototype, 'save').resolves();

    const findOrCreateByOriginStub = sandbox.stub(service['locationService'], 'findOrCreatePlaceByOriginUri').resolves(resolvedPlace);
    const flatFindOrCreateStub = sandbox.stub(service['locationService'], 'findOrCreateLocation');

    await service.updateRemoteEvent(cal, {
      id: '11111111-1111-4111-8111-111111111111',
      location: { name: 'Town Hall', originUri },
    });

    expect(findOrCreateByOriginStub.calledOnce).toBe(true);
    expect(findOrCreateByOriginStub.firstCall.args[1]).toBe(originUri);
    expect(flatFindOrCreateStub.called).toBe(false);
    expect(eventEntity.location_id).toBe('place-1');
  });

  it('falls back to flat findOrCreateLocation on update when origin_uri is absent', async () => {
    const flatPlace = new EventLocation('place-flat', 'Plain Venue');

    const eventEntity = EventEntity.build({
      id: '22222222-2222-4222-8222-222222222222',
      calendar_id: null,
    });
    sandbox.stub(EventEntity, 'findByPk').resolves(eventEntity);
    sandbox.stub(EventEntity.prototype, 'save').resolves();

    const flatFindOrCreateStub = sandbox.stub(service['locationService'], 'findOrCreateLocation').resolves(flatPlace);
    const findOrCreateByOriginStub = sandbox.stub(service['locationService'], 'findOrCreatePlaceByOriginUri');

    await service.updateRemoteEvent(cal, {
      id: '22222222-2222-4222-8222-222222222222',
      location: { name: 'Plain Venue' },
    });

    expect(flatFindOrCreateStub.calledOnce).toBe(true);
    expect(findOrCreateByOriginStub.called).toBe(false);
    expect(eventEntity.location_id).toBe('place-flat');
  });

  it('clears space_id when payload drops the location entirely', async () => {
    const eventEntity = EventEntity.build({
      id: '33333333-3333-4333-8333-333333333333',
      calendar_id: null,
      location_id: 'place-existing',
      space_id: 'space-existing',
    });
    sandbox.stub(EventEntity, 'findByPk').resolves(eventEntity);
    sandbox.stub(EventEntity.prototype, 'save').resolves();

    await service.updateRemoteEvent(cal, {
      id: '33333333-3333-4333-8333-333333333333',
      // no location, no space
    });

    expect(eventEntity.location_id).toBeNull();
    expect(eventEntity.space_id).toBeNull();
  });
});
