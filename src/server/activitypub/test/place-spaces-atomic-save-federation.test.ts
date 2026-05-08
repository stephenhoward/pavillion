import { EventEmitter } from 'events';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';
import config from 'config';

import ActivityPubEventHandlers from '@/server/activitypub/events';
import ActivityPubInterface from '@/server/activitypub/interface';
import CalendarInterface from '@/server/calendar/interface';
import UpdateActivity from '@/server/activitypub/model/action/update';
import { EventObject } from '@/server/activitypub/model/object/event';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventContent } from '@/common/model/events';
import {
  EventLocation,
  EventLocationContent,
  EventLocationSpace,
  EventLocationSpaceContent,
} from '@/common/model/location';

/**
 * Federation regression test for the Place + Spaces atomic-save model.
 *
 * The atomic-save architecture commits us to leaving outbound AP
 * serialization untouched: per-event Update(Event) activities continue to
 * carry the existing `pavillion:place` and `pavillion:space` references,
 * exactly as before. The Place save changes only what Pavillion stores; what
 * federates is still per-event.
 *
 * This test asserts that contract end-to-end. It captures the AP activity
 * emitted on `eventUpdated` for an event whose Space changed via the new
 * atomic-save path and field-by-field compares its on-the-wire shape with
 * what `EventObject.toActivityPubObject()` would have produced under the
 * legacy per-Space CRUD model. If a future change to the AP model drifts
 * the wire shape, this test fails and forces a deliberate decision.
 */
describe('Place+Spaces atomic save: federation regression', () => {
  let service: ActivityPubInterface;
  let handlers: ActivityPubEventHandlers;
  let eventBus: EventEmitter;
  let sandbox: sinon.SinonSandbox;

  const domain = config.get<string>('domain');

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    service = new ActivityPubInterface(eventBus);
    handlers = new ActivityPubEventHandlers(service, new CalendarInterface(eventBus));
    handlers.install(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
  });

  /**
   * Build a CalendarEvent populated with location and space. Mirrors the
   * shape that the AP serializer expects after a local DB save (whether the
   * write went through the new atomic Place save or the old per-Space CRUD
   * path — the in-memory CalendarEvent surface is identical either way).
   */
  function buildEventWithPlaceAndSpace(opts: {
    calendarId: string;
    eventId: string;
    locationId: string;
    spaceId: string;
  }): CalendarEvent {
    const event = new CalendarEvent(opts.eventId, opts.calendarId);
    event.addContent(new CalendarEventContent('en', 'My Event', 'Description'));

    const location = new EventLocation(
      opts.locationId,
      'Convention Center',
      '100 Main St',
      'Springfield',
      'OR',
      '97477',
      'US',
    );
    location.addContent(new EventLocationContent('en', 'Accessible parking'));
    event.location = location;

    const space = new EventLocationSpace(opts.spaceId, opts.locationId);
    space.addContent(new EventLocationSpaceContent('en', 'Pacific Room', 'Hearing loop'));
    event.space = space;

    return event;
  }

  it('emits a per-event Update with pavillion:place + pavillion:space references unchanged after atomic-save Space change', async () => {
    // Arrange — minimal local calendar; the AP id format is the contract under
    // test, not the persisted row, so we don't touch the DB.
    const calendar = Calendar.fromObject({ id: uuidv4(), urlName: 'mycal' });
    const eventId = uuidv4();
    const locationId = uuidv4();
    const spaceId = uuidv4();
    const event = buildEventWithPlaceAndSpace({
      calendarId: calendar.id,
      eventId,
      locationId,
      spaceId,
    });

    const actorUrl = `https://${domain}/calendars/mycal`;
    sandbox.stub(service, 'actorUrl').resolves(actorUrl);
    const addToOutboxStub = sandbox.stub(service, 'addToOutbox').resolves();

    // Act — the new atomic-save path, when Place changes a Space, emits one
    // `eventUpdated` per affected event (no new "Place activity" exists per
    // Architectural Decision 6). The handler under test fan-outs that to a
    // per-event AP Update.
    eventBus.emit('eventUpdated', { calendar, event });
    await new Promise(resolve => setTimeout(resolve, 50));

    // Assert — exactly one outbox enqueue happened, and it carried an Update
    // (NOT something Place-shaped). Architectural Decision 6 forbids Place-
    // level AP activities; this assertion is the load-bearing guard.
    expect(addToOutboxStub.calledOnce, 'exactly one Update enqueued for the event').toBe(true);
    const [calendarArg, activity] = addToOutboxStub.getCall(0).args;
    expect(calendarArg).toBe(calendar);
    expect(activity).toBeInstanceOf(UpdateActivity);
    expect((activity as UpdateActivity).type).toBe('Update');

    // Compare the emitted object against a freshly-built EventObject of the
    // same CalendarEvent. Field-by-field equality is the regression assertion:
    // if the atomic-save path ever drifts the wire shape, these two diverge
    // and the test fails.
    //
    // startTime/endTime are stripped before comparison because the AP
    // serializer synthesizes them from `new Date()` when the source event
    // has no `date` populated (this fixture omits a schedule for brevity);
    // the resulting drift between the two `new Date()` calls is timing
    // noise, not contract drift. The Place + Space wire shape — the actual
    // subject of this regression — is unaffected and asserted explicitly.
    const emittedObject = (activity as any).object as EventObject;
    const emittedAp = emittedObject.toActivityPubObject();
    const expectedAp = new EventObject(calendar, event).toActivityPubObject();
    delete emittedAp.startTime;
    delete emittedAp.endTime;
    delete expectedAp.startTime;
    delete expectedAp.endTime;

    expect(emittedAp).toEqual(expectedAp);

    // Belt-and-braces — pin the most regression-prone fields explicitly so
    // failures point to the exact wire-shape contract that broke.
    expect(emittedAp['pavillion:place']).toBeDefined();
    expect(emittedAp['pavillion:place'].id).toBe(
      `https://${domain}/calendars/mycal/places/${locationId}`,
    );
    expect(emittedAp['pavillion:place'].address).toBe('100 Main St');
    expect(emittedAp['pavillion:place'].content.en).toEqual({
      name: 'Convention Center',
      accessibilityInfo: 'Accessible parking',
    });

    expect(emittedAp['pavillion:space']).toBeDefined();
    expect(emittedAp['pavillion:space'].id).toBe(
      `https://${domain}/calendars/mycal/places/${locationId}/spaces/${spaceId}`,
    );
    // Parent-path nesting is structural: inbound peers use the prefix
    // `${placeId}/spaces/` to anchor pavillion:space to its parent
    // pavillion:place. Drift here breaks federation round-trip silently.
    expect(emittedAp['pavillion:space'].id.startsWith(
      `${emittedAp['pavillion:place'].id}/spaces/`,
    )).toBe(true);
    expect(emittedAp['pavillion:space'].content.en).toEqual({
      name: 'Pacific Room',
      accessibilityInfo: 'Hearing loop',
    });
  });

  it('emits a per-event Update for an event whose Space was removed by atomic-save (now whole-venue)', async () => {
    // Per Architectural Decision 3, deleting a Space sets `events.space_id` to
    // NULL via FK ON DELETE SET NULL. The post-save `eventUpdated` for that
    // event must federate as a whole-venue Update — pavillion:place present,
    // pavillion:space absent — exactly as today's per-Space-delete path does.
    const calendar = Calendar.fromObject({ id: uuidv4(), urlName: 'mycal' });
    const eventId = uuidv4();
    const locationId = uuidv4();

    const event = new CalendarEvent(eventId, calendar.id);
    event.addContent(new CalendarEventContent('en', 'Whole Venue Event', 'Description'));
    const location = new EventLocation(locationId, 'Convention Center', '100 Main St', 'Springfield', 'OR', '97477', 'US');
    location.addContent(new EventLocationContent('en', 'Accessible parking'));
    event.location = location;
    // No event.space — the Space row was deleted, FK SET NULL nulled the FK.

    const actorUrl = `https://${domain}/calendars/mycal`;
    sandbox.stub(service, 'actorUrl').resolves(actorUrl);
    const addToOutboxStub = sandbox.stub(service, 'addToOutbox').resolves();

    eventBus.emit('eventUpdated', { calendar, event });
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(addToOutboxStub.calledOnce).toBe(true);
    const activity = addToOutboxStub.getCall(0).args[1];
    const emittedAp = (activity as any).object.toActivityPubObject();

    expect(emittedAp['pavillion:place']).toBeDefined();
    expect(emittedAp['pavillion:place'].id).toBe(
      `https://${domain}/calendars/mycal/places/${locationId}`,
    );
    // pavillion:space MUST be omitted when no space — emitting a stale
    // reference would mis-describe the event to federation peers.
    expect(emittedAp).not.toHaveProperty('pavillion:space');
  });
});

/**
 * Decision: federation source-of-truth on inbound Space re-pin.
 *
 * When a federated event was Space-pinned and the local Space is later
 * deleted (FK SET NULL drops `events.space_id`), the inbound Update handler
 * re-pins the event if the remote re-sends the same `pavillion:space`
 * reference. The local null is NOT sticky.
 *
 * Rationale (contrast with DEC-008 RepostDismissals):
 *   - DEC-008's per-calendar dismissal stickiness exists because the user
 *     EXPLICITLY chose to unpost. The dismissal is an intent signal.
 *   - Here, the local space_id null is automatic plumbing — FK SET NULL
 *     fires when the local Space row is destroyed, with no per-event
 *     intent signal attached. There is no user choice "this event should
 *     stop being space-pinned"; there is only "this Space row went away."
 *   - The federated source still describes the event as Space-pinned. The
 *     local Pavillion calendar's bookkeeping change (Space deleted) does
 *     not invalidate the source's organizational truth. Re-resolving the
 *     pavillion:space reference via origin_uri is the correct posture.
 *   - The dedup helper `findOrCreateSpaceByOriginUri` already round-trips
 *     this naturally: it scopes by `(place_id, origin_uri)`, so when the
 *     prior Space row was destroyed, the next inbound Update creates a
 *     fresh local row keyed on the same origin_uri and re-pins the event.
 *
 * This decision is a behavioral note on existing code; no new code path is
 * introduced. The test below pins the behavior so a future refactor cannot
 * accidentally introduce sticky-null semantics without an explicit choice.
 *
 * This is NOT a new decisions.md entry — DEC-008 remains the controlling
 * authority for the sticky-vs-source-of-truth pattern, and this case falls
 * cleanly on the source-of-truth side (no explicit user intent signal).
 */
describe('Place+Spaces inbound re-pin: federation source-of-truth', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('inbound Update with pavillion:space re-pins an event whose space_id was nulled by FK SET NULL', () => {
    // The contract this test pins: when the inbound parser sees a
    // pavillion:space whose id parent path matches the pavillion:place.id,
    // the parser emits `result.space.originUri` set to the validated space
    // id, and `resolveRemoteLocationAndSpace` will route through
    // `findOrCreateSpaceByOriginUri` to re-resolve the local Space row
    // (creating one if the prior row was destroyed by Place-save). The
    // outcome is that EventEntity.space_id becomes non-null again.
    //
    // We assert the parse-stage outcome here — the structural input the
    // downstream resolver consumes. The downstream dedup behavior is
    // covered by the existing tests in:
    //   - location_origin_uri_service.test.ts (findOrCreateSpaceByOriginUri)
    //   - EventService/add_remote_event_dedup.test.ts (resolveRemoteLocationAndSpace
    //     wires spaces through the dedup helper on the inbound update path)
    //
    // Together they cover the full chain. Sticky-null would require an
    // additional gate inserted between the parser and the resolver — no
    // such gate exists, by design.

    const placeApId = `https://remote.example/calendars/mycal/places/place-uuid`;
    const spaceApId = `${placeApId}/spaces/space-uuid`;

    const apObject = {
      type: 'Event',
      id: 'https://remote.example/calendars/mycal/events/evt-uuid',
      attributedTo: 'https://remote.example/calendars/mycal',
      name: 'Federated Event',
      startTime: '2026-06-01T18:00:00Z',
      'pavillion:place': {
        id: placeApId,
        address: '1 Main St',
        city: 'Springfield',
        state: 'OR',
        postalCode: '97477',
        country: 'US',
        content: {
          en: { name: 'Convention Center', accessibilityInfo: 'Accessible parking' },
        },
      },
      'pavillion:space': {
        id: spaceApId,
        content: {
          en: { name: 'Pacific Room', accessibilityInfo: 'Hearing loop' },
        },
      },
    };

    // Pass actorUri so _validatePavillionId stamps origin_uri (host equality
    // check passes — same origin as the place + space ids).
    const result = EventObject.fromActivityPubObject(apObject, {
      actorUri: 'https://remote.example/calendars/mycal',
    });

    // Place restored with origin_uri.
    expect(result.location).toBeDefined();
    expect(result.location.originUri).toBe(placeApId);

    // Space restored with origin_uri — this is the input the inbound update
    // path's resolver consumes. With this present, `resolveRemoteLocationAndSpace`
    // routes through `findOrCreateSpaceByOriginUri`, which re-creates a local
    // Space row keyed on origin_uri if none exists (the FK SET NULL scenario).
    // The outcome is `eventEntity.space_id = resolved.space.id` in
    // updateRemoteEvent — i.e. re-pin.
    expect(result.space).toBeDefined();
    expect(result.space.originUri).toBe(spaceApId);

    // The originUri carries through to the downstream resolver as the dedup
    // key. Federation source-of-truth: the remote sender's organizational
    // structure governs the local pin, regardless of whether the local row
    // currently exists.
    expect(result.space.originUri).toMatch(/\/places\/[^/]+\/spaces\/[^/]+$/);
  });

  it('inbound Update without pavillion:space leaves space null (no sticky pin from earlier state)', () => {
    // The mirror case: when the remote intentionally drops the Space (event
    // becomes whole-venue federally), the inbound parser MUST NOT carry a
    // stale local space pin into the resolved params. This guards against
    // a regression where source-of-truth becomes "additive only."
    const placeApId = 'https://remote.example/calendars/mycal/places/place-uuid';

    const apObject = {
      type: 'Event',
      id: 'https://remote.example/calendars/mycal/events/evt-uuid',
      attributedTo: 'https://remote.example/calendars/mycal',
      name: 'Federated Event (now whole-venue)',
      startTime: '2026-06-01T18:00:00Z',
      'pavillion:place': {
        id: placeApId,
        address: '1 Main St',
        city: 'Springfield',
        state: 'OR',
        postalCode: '97477',
        country: 'US',
        content: {
          en: { name: 'Convention Center', accessibilityInfo: 'Accessible parking' },
        },
      },
      // No pavillion:space — the source moved the event to whole-venue.
    };

    const result = EventObject.fromActivityPubObject(apObject, {
      actorUri: 'https://remote.example/calendars/mycal',
    });

    expect(result.location).toBeDefined();
    expect(result.location.originUri).toBe(placeApId);
    // space MUST be absent in the parse output. updateRemoteEvent then sets
    // eventEntity.space_id = null. Federation source-of-truth on the
    // negative path too.
    expect(result.space).toBeUndefined();
  });
});
