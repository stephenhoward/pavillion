import { EventEmitter } from 'events';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';

import ActivityPubEventHandlers from '@/server/activitypub/events';
import ActivityPubInterface from '@/server/activitypub/interface';
import CalendarInterface from '@/server/calendar/interface';
import { ActivityPubInboxMessageEntity, ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import { ActivityPubActor } from '@/server/activitypub/model/base';
import { EventObject } from '@/server/activitypub/model/object/event';
import { NoteObject } from '@/server/activitypub/model/object/note';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventContent } from '@/common/model/events';
import { EventLocation, EventLocationContent, EventLocationSpace, EventLocationSpaceContent } from '@/common/model/location';
import { setupActivityPubSchema, teardownActivityPubSchema } from '@/server/common/test/helpers/database';

describe('inbox event listener', () => {
  let service: ActivityPubInterface;
  let eventHandler: ActivityPubEventHandlers;
  let eventBus: EventEmitter;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach (() => {
    eventBus = new EventEmitter();
    service = new ActivityPubInterface(eventBus);
    eventHandler = new ActivityPubEventHandlers(service, new CalendarInterface(eventBus), { publishJob: async () => {} } as any);
    eventHandler.install(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should process message found in database', async () => {

    let processorStub = sandbox.stub(service,'processInboxMessage');
    let entityStub = sandbox.stub(ActivityPubInboxMessageEntity,'findByPk');
    entityStub.resolves(
      ActivityPubInboxMessageEntity.build({
        calendar_id: 'testid', type: 'Create', message: { object: { id: 'testid' } },
      }),
    );

    eventBus.emit('inboxMessageAdded',{ id: 'testid' });

    // wait for event to propogate:
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(processorStub.calledOnce).toBe(true);
  });

  it('should ignore message not found in database', async () => {

    let processorStub = sandbox.stub(service,'processInboxMessage');
    let entityStub = sandbox.stub(ActivityPubInboxMessageEntity,'findByPk');
    entityStub.resolves(undefined);

    eventBus.emit('inboxMessageAdded',{ id: 'testid' });

    // wait for event to propogate:
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(processorStub.calledOnce).toBe(false);
  });
});

describe('outbox event listener', () => {
  let service: ActivityPubInterface;
  let eventHandler: ActivityPubEventHandlers;
  let eventBus: EventEmitter;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach (() => {
    eventBus = new EventEmitter();
    service = new ActivityPubInterface(eventBus);
    eventHandler = new ActivityPubEventHandlers(service, new CalendarInterface(eventBus), { publishJob: async () => {} } as any);
    eventHandler.install(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should process message found in database', async () => {

    let processorStub = sandbox.stub(service,'processOutboxMessage');
    let entityStub = sandbox.stub(ActivityPubOutboxMessageEntity,'findByPk');
    entityStub.resolves(
      ActivityPubOutboxMessageEntity.build({
        calendar_id: 'testid', type: 'Create', message: { object: { id: 'testid' } },
      }),
    );

    eventBus.emit('outboxMessageAdded',{
      calendar_id: 'testid',
      type: 'Create',
      message: { object: { id: 'testid' } },
    });

    // wait for event to propogate:
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(processorStub.calledOnce).toBe(true);
  });

  it('should ignore message not found in database', async () => {

    let processorStub = sandbox.stub(service,'processOutboxMessage');
    let entityStub = sandbox.stub(ActivityPubOutboxMessageEntity,'findByPk');
    entityStub.resolves(undefined);

    eventBus.emit('outboxMessageAdded',{
      calendar_id: 'testid',
      type: 'Create',
      message: { object: { id: 'testid' } },
    });

    // wait for event to propogate:
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(processorStub.calledOnce).toBe(false);
  });
});

describe('handleEventUpdated guard', () => {
  let service: ActivityPubInterface;
  let eventHandler: ActivityPubEventHandlers;
  let eventBus: EventEmitter;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach (() => {
    eventBus = new EventEmitter();
    service = new ActivityPubInterface(eventBus);
    eventHandler = new ActivityPubEventHandlers(service, new CalendarInterface(eventBus), { publishJob: async () => {} } as any);
    eventHandler.install(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should skip re-broadcasting when payload.calendar is null (remote event update)', async () => {
    const actorUrlStub = sandbox.stub(service, 'actorUrl');
    const addToOutboxStub = sandbox.stub(service, 'addToOutbox');

    const event = CalendarEvent.fromObject({ id: 'remote-event-id' });

    // Emit eventUpdated with null calendar (simulates remote event update)
    eventBus.emit('eventUpdated', { calendar: null, event });

    // Wait for event to propagate
    await new Promise(resolve => setTimeout(resolve, 100));

    // actorUrl and addToOutbox should never be called
    expect(actorUrlStub.called).toBe(false);
    expect(addToOutboxStub.called).toBe(false);
  });

  it('should skip re-broadcasting when payload.calendar is undefined (remote event update)', async () => {
    const actorUrlStub = sandbox.stub(service, 'actorUrl');
    const addToOutboxStub = sandbox.stub(service, 'addToOutbox');

    const event = CalendarEvent.fromObject({ id: 'remote-event-id' });

    // Emit eventUpdated with undefined calendar
    eventBus.emit('eventUpdated', { calendar: undefined, event });

    // Wait for event to propagate
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(actorUrlStub.called).toBe(false);
    expect(addToOutboxStub.called).toBe(false);
  });

  it('should broadcast paired Update(Event) + Update(Note) when payload.calendar is present (local event update)', async () => {
    const calendar = Calendar.fromObject({ id: 'local-calendar-id', urlName: 'my_calendar' });
    const event = CalendarEvent.fromObject({ id: 'local-event-id' });

    const actorUrlStub = sandbox.stub(service, 'actorUrl');
    actorUrlStub.resolves('https://example.com/calendars/my_calendar');

    const addToOutboxStub = sandbox.stub(service, 'addToOutbox');
    addToOutboxStub.resolves();

    eventBus.emit('eventUpdated', { calendar, event });

    // Wait for event to propagate
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(actorUrlStub.calledOnce).toBe(true);
    // Paired emission: Update(Event) + Update(Note) so Mastodon-class peers see
    // the edit on profile timelines alongside the Pavillion-native Update(Event).
    expect(addToOutboxStub.calledTwice).toBe(true);

    const eventCall = addToOutboxStub.getCall(0);
    expect(eventCall.args[0]).toBe(calendar);
    const updateEvent = eventCall.args[1];
    expect(updateEvent.type).toBe('Update');
    expect(updateEvent.object.type).toBe('Event');
    // Update activities must be addressed publicly so AP consumers (Mastodon
    // included) treat them as visible profile timeline activity rather than
    // private/addressless updates.
    expect(updateEvent.to).toEqual(['https://www.w3.org/ns/activitystreams#Public']);
    expect(updateEvent.cc).toEqual(['https://example.com/calendars/my_calendar/followers']);
    expect(updateEvent.published).toBeInstanceOf(Date);

    const noteCall = addToOutboxStub.getCall(1);
    // Attribution invariant: the same calendar argument flows to both calls so
    // outbox dispatcher attribution remains consistent across the pair.
    expect(noteCall.args[0]).toBe(calendar);
    const updateNote = noteCall.args[1];
    expect(updateNote.type).toBe('Update');
    expect(updateNote.object.type).toBe('Note');
    expect(updateNote.to).toEqual(['https://www.w3.org/ns/activitystreams#Public']);
    expect(updateNote.cc).toEqual(['https://example.com/calendars/my_calendar/followers']);
    expect(updateNote.published).toBeInstanceOf(Date);
  });
});

describe('handleEventCreated', () => {
  let service: ActivityPubInterface;
  let handlers: ActivityPubEventHandlers;
  let eventBus: EventEmitter;
  let sandbox: sinon.SinonSandbox;

  beforeEach(async () => {
    await setupActivityPubSchema();
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    service = new ActivityPubInterface(eventBus);
    handlers = new ActivityPubEventHandlers(service, new CalendarInterface(eventBus), { publishJob: async () => {} } as any);
    handlers.install(eventBus);
  });

  afterEach(async () => {
    sandbox.restore();
    await teardownActivityPubSchema();
  });

  it('creates an EventObjectEntity for the local event before dispatching paired Create(Event) + Create(Note)', async () => {
    const calendar = Calendar.fromObject({ id: uuidv4(), urlName: 'my_calendar' });
    const event = CalendarEvent.fromObject({ id: uuidv4() });
    const actorUrl = ActivityPubActor.actorUrl(calendar);
    const eventUrl = EventObject.eventUrl(calendar, event);

    // Stub the service methods that would otherwise hit the database / network
    sandbox.stub(service, 'actorUrl').resolves(actorUrl);
    const addToOutboxStub = sandbox.stub(service, 'addToOutbox').resolves();

    // Invoke the private handler directly so we can deterministically assert
    // on the persisted EventObjectEntity row.
    await (handlers as any)['handleEventCreated']({ calendar, event });

    const eventObject = await EventObjectEntity.findOne({ where: { event_id: event.id } });
    expect(eventObject, 'EventObjectEntity must exist for local event').not.toBeNull();
    expect(eventObject!.attributed_to).toBe(actorUrl);
    // Paired emission: Create(Event) first, Create(Note) second, both with
    // public addressing. New local originals federate as Create(Event) with the
    // full embedded Event object (Announce is reserved for reposts); the paired
    // Create(Note) lets Mastodon-class peers render the event on profile
    // timelines.
    expect(addToOutboxStub.calledTwice).toBe(true);

    // Create(Event) envelope must embed the full Event object, carry the
    // deterministic `{eventUrl}/create` id, and be addressed publicly with
    // followers in cc and a populated published timestamp — without these,
    // Mastodon/Mobilizon/Gancio ignore the activity or lose audience info.
    const createEventCall = addToOutboxStub.getCall(0);
    expect(createEventCall.args[0]).toBe(calendar);
    const createEvent = createEventCall.args[1];
    expect(createEvent.type).toBe('Create');
    expect(createEvent.object.type).toBe('Event');
    expect(createEvent.id).toBe(`${eventUrl}/create`);
    expect(createEvent.to).toEqual(['https://www.w3.org/ns/activitystreams#Public']);
    expect(createEvent.cc).toEqual([`${actorUrl}/followers`]);
    expect(createEvent.published).toBeInstanceOf(Date);

    // PRIVACY: the embedded Event object is now sent to federation (public +
    // followers), so its serialized wire form must not leak internal
    // identifiers. Actors are addressed by public URL (attributedTo), never by
    // the internal calendar/account UUIDs. This guards against a regression
    // that serializes internal ids onto the public payload.
    const embeddedEvent = (createEvent.object as EventObject).toActivityPubObject();
    expect(embeddedEvent).not.toHaveProperty('calendarId');
    expect(embeddedEvent).not.toHaveProperty('accountId');
    expect(embeddedEvent.attributedTo).toBe(actorUrl);

    // No Announce is emitted for originals — Announce is repost-only.
    const emittedTypes = addToOutboxStub.getCalls().map(c => c.args[1].type);
    expect(emittedTypes).not.toContain('Announce');

    // Paired Create(Note) emission with matching public addressing. The Note
    // wraps the same canonical event so Mastodon-class peers render it on
    // profile timelines.
    const createCall = addToOutboxStub.getCall(1);
    // Attribution invariant: the same calendar argument flows to both calls.
    expect(createCall.args[0]).toBe(calendar);
    const create = createCall.args[1];
    expect(create.type).toBe('Create');
    expect(create.object.type).toBe('Note');
    expect(create.to).toEqual(['https://www.w3.org/ns/activitystreams#Public']);
    expect(create.cc).toEqual([`${actorUrl}/followers`]);
    expect(create.published).toBeInstanceOf(Date);
  });

  it('logs a warning but does not overwrite EventObjectEntity when a pre-existing row has mismatched attributed_to', async () => {
    const calendar = Calendar.fromObject({ id: uuidv4(), urlName: 'my_calendar' });
    const event = CalendarEvent.fromObject({ id: uuidv4() });
    const actorUrl = ActivityPubActor.actorUrl(calendar);
    const spoofAttributedTo = 'https://spoof.example/actors/attacker';

    // Pre-create a row for this event_id with a DIFFERENT attributed_to. This
    // simulates an integrity-violating scenario where a remote-looking row
    // exists before the local event is emitted. The handler must detect the
    // mismatch and refuse to overwrite it, while still proceeding with dispatch.
    await EventObjectEntity.create({
      event_id: event.id,
      ap_id: 'https://pre-existing.example/events/spoof',
      attributed_to: spoofAttributedTo,
    });

    // Stub service methods to prevent real network / persistence
    sandbox.stub(service, 'actorUrl').resolves(actorUrl);
    const addToOutboxStub = sandbox.stub(service, 'addToOutbox').resolves();

    // Note: the events/index.ts module imports a pino child logger via
    // createLogger('activitypub') at module scope. In test mode that logger
    // runs at 'silent' level and the instance is not exported, so asserting
    // on .warn calls would require monkey-patching pino internals. The
    // behavioral contract is what matters for the security property: the
    // pre-existing row must not be overwritten, and dispatch must still
    // proceed. We assert those directly below.

    // Invoke the handler
    await (handlers as any)['handleEventCreated']({ calendar, event });

    // Primary assertion: the pre-existing row is NOT overwritten. The defensive
    // check in handleEventCreated must leave the spoof attributed_to intact.
    const preserved = await EventObjectEntity.findOne({ where: { event_id: event.id } });
    expect(preserved, 'row must still exist').not.toBeNull();
    expect(
      preserved!.attributed_to,
      'pre-existing attributed_to must NOT be overwritten by handleEventCreated',
    ).toBe(spoofAttributedTo);

    // Secondary assertion: despite the integrity signal, the event is still
    // dispatched to the outbox. This is the documented behavior — the warn is
    // a signal, not a hard stop. Both legs of the paired emission run.
    expect(
      addToOutboxStub.calledTwice,
      'addToOutbox must still be called for both legs of the pair so the event reaches federation',
    ).toBe(true);
  });

  it('returns early without dispatching Create when payload.calendar is null (remote-origin event)', async () => {
    // EventService.addRemoteEvent emits eventCreated with calendar:null so the
    // calendar-domain buildEventInstances handler materializes canonical rows
    // for inbound federated events. The AP handler must early-return on the
    // same payload — without this guard, the handler would call
    // EventObject.eventUrl(null, ...) (crash) and addToOutbox(null, ...)
    // (re-Create a remote event back to federation, creating a loop).
    const event = CalendarEvent.fromObject({ id: uuidv4() });

    const actorUrlStub = sandbox.stub(service, 'actorUrl');
    const addToOutboxStub = sandbox.stub(service, 'addToOutbox');

    // Invoke the private handler directly so the guard's behavior is asserted
    // deterministically without racing setImmediate hops.
    await (handlers as any)['handleEventCreated']({ calendar: null, event });

    expect(actorUrlStub.called, 'actorUrl must not be called for remote-origin events').toBe(false);
    expect(addToOutboxStub.called, 'addToOutbox must not be called for remote-origin events').toBe(false);

    // No EventObjectEntity row should be persisted either — the local server
    // is not the AP origin for this event, so it has no actor to attribute.
    const eventObject = await EventObjectEntity.findOne({ where: { event_id: event.id } });
    expect(eventObject, 'no EventObjectEntity row for remote-origin event').toBeNull();
  });

});

describe('handleEventDeleted', () => {
  let service: ActivityPubInterface;
  let handlers: ActivityPubEventHandlers;
  let eventBus: EventEmitter;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    eventBus = new EventEmitter();
    service = new ActivityPubInterface(eventBus);
    handlers = new ActivityPubEventHandlers(service, new CalendarInterface(eventBus), { publishJob: async () => {} } as any);
    handlers.install(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should broadcast paired Delete(Event) + Delete(Note) with public addressing and the same calendar arg', async () => {
    const calendar = Calendar.fromObject({ id: uuidv4(), urlName: 'my_calendar' });
    const event = CalendarEvent.fromObject({ id: uuidv4() });
    const actorUrl = ActivityPubActor.actorUrl(calendar);

    sandbox.stub(service, 'actorUrl').resolves(actorUrl);
    const addToOutboxStub = sandbox.stub(service, 'addToOutbox').resolves();

    // Invoke the private handler directly so the paired emission is asserted
    // deterministically without racing setImmediate hops.
    await (handlers as any)['handleEventDeleted']({ calendar, event });

    // Paired emission: Delete(Event) first, Delete(Note) second.
    expect(addToOutboxStub.calledTwice).toBe(true);

    const eventCall = addToOutboxStub.getCall(0);
    expect(eventCall.args[0]).toBe(calendar);
    const deleteEvent = eventCall.args[1];
    expect(deleteEvent.type).toBe('Delete');
    // Delete activities carry the object URL as a string (not an embedded
    // object), so we assert the canonical Event IRI form.
    expect(deleteEvent.object).toBe(EventObject.eventUrl(calendar, event));
    expect(deleteEvent.to).toEqual(['https://www.w3.org/ns/activitystreams#Public']);
    expect(deleteEvent.cc).toEqual([`${actorUrl}/followers`]);
    expect(deleteEvent.published).toBeInstanceOf(Date);

    const noteCall = addToOutboxStub.getCall(1);
    // Attribution invariant: the same calendar argument flows to both calls.
    expect(noteCall.args[0]).toBe(calendar);
    const deleteNote = noteCall.args[1];
    expect(deleteNote.type).toBe('Delete');
    // The Delete(Note) carries the Note IRI string form, NOT a Note object —
    // mirroring the Event Delete shape.
    expect(deleteNote.object).toBe(NoteObject.noteUrl(calendar, event));
    expect(typeof deleteNote.object).toBe('string');
    expect(deleteNote.to).toEqual(['https://www.w3.org/ns/activitystreams#Public']);
    expect(deleteNote.cc).toEqual([`${actorUrl}/followers`]);
    expect(deleteNote.published).toBeInstanceOf(Date);
  });
});

describe('AP serialize → parse round-trip (Place + Space + multilingual content)', () => {
  // Integration test for the Place + Spaces federation surface.
  //
  // This test exercises both the outbound emit path (toActivityPubObject) and
  // the inbound priority-consumption path (fromActivityPubObject) together. It
  // is the structural guard against drift between the two surfaces: when emit
  // changes shape but consume does not (or vice versa), this test fails.
  //
  // Per the Option B wire shape, content[lang] entries on both pavillion:place
  // and pavillion:space carry BOTH name and accessibilityInfo. The inbound
  // parser uses the structured pavillion:place content[lang].name to populate
  // restored.location.name (NOT the concatenated flat as:Place.name, which is
  // a non-Pavillion-peer fallback only).

  it('round-trips Place + Space + multilingual content via AP serialization', () => {
    // Build a fully-populated event with a Place (with address + per-language
    // accessibility content) and a Space (with per-language name +
    // accessibility content), in two languages.
    const calendar = new Calendar(uuidv4(), 'mycal');
    const event = new CalendarEvent(uuidv4(), calendar.id);
    event.addContent(new CalendarEventContent('en', 'My Event', 'Description'));
    event.addContent(new CalendarEventContent('fr', 'Mon Évènement', 'La description'));

    const location = new EventLocation(
      uuidv4(),
      'Convention Center',
      '100 Main St',
      'Springfield',
      'OR',
      '97477',
      'US',
    );
    location.addContent(new EventLocationContent('en', 'Accessible parking'));
    location.addContent(new EventLocationContent('fr', 'Stationnement accessible'));
    event.location = location;

    const space = new EventLocationSpace(uuidv4(), location.id);
    space.addContent(new EventLocationSpaceContent('en', 'Pacific Room', 'Hearing loop'));
    space.addContent(new EventLocationSpaceContent('fr', 'Salle Pacifique', 'Boucle auditive'));
    event.space = space;

    // Serialize → parse round trip.
    const apObject = new EventObject(calendar, event).toActivityPubObject();
    const restored = EventObject.fromActivityPubObject(apObject);

    // --- Place restoration ---
    // restored.location must be populated. Guarded with not.toBeNull() so a
    // structural failure here gives a clear error, not a TypeError on the
    // following property accesses.
    expect(restored.location, 'restored.location must be present after round-trip').not.toBeNull();
    expect(restored.location, 'restored.location must be present after round-trip').toBeDefined();

    // restored.location.name comes from the structured pavillion:place
    // content[lang].name (priority-consumed by fromActivityPubObject), NOT
    // from the concatenated flat as:Place.name (which would be
    // 'Convention Center — Pacific Room' for this event). The inbound parser
    // picks the first available content[lang].name, which today carries the
    // single-string Place name in every language slot.
    expect(restored.location.name).toBe('Convention Center');

    // Address fields round-trip via the flat top-level keys on pavillion:place.
    expect(restored.location.address).toBe('100 Main St');
    expect(restored.location.city).toBe('Springfield');
    expect(restored.location.state).toBe('OR');
    expect(restored.location.postalCode).toBe('97477');
    expect(restored.location.country).toBe('US');

    // Per-language accessibility content survives. The local model's
    // EventLocation content stores accessibilityInfo only (Place names are
    // not yet translatable), so the inbound parser strips the per-language
    // name from content[lang] when shaping for EventLocation.fromObject.
    expect(restored.location.content, 'restored.location.content must be present').not.toBeNull();
    expect(restored.location.content).toBeDefined();
    expect(restored.location.content.en).toBeDefined();
    expect(restored.location.content.fr).toBeDefined();
    expect(restored.location.content.en.accessibilityInfo).toBe('Accessible parking');
    expect(restored.location.content.fr.accessibilityInfo).toBe('Stationnement accessible');

    // --- Wire-shape assertion: Option B content carries name in every entry ---
    // Distinct from the EventLocation-shaped restored.location: the AP wire
    // object itself MUST carry name alongside accessibilityInfo per language
    // on pavillion:place.content. This is the Option B contract — when Place
    // names later become translatable, only the local-model storage changes;
    // the wire format stays identical.
    expect(apObject['pavillion:place'], 'pavillion:place must be present on the wire').toBeDefined();
    expect(apObject['pavillion:place'].content.en).toEqual({
      name: 'Convention Center',
      accessibilityInfo: 'Accessible parking',
    });
    expect(apObject['pavillion:place'].content.fr).toEqual({
      name: 'Convention Center',
      accessibilityInfo: 'Stationnement accessible',
    });

    // --- Wire-shape assertion: flat as:Place.name is the concatenated label ---
    // Non-Pavillion peers (Mobilizon, Mastodon, Gancio) read the flat
    // as:Place.name. With a Space present, that flat surface MUST carry the
    // concatenated 'Place — Space' label so the non-aware-peer rendering is
    // still useful. The inbound parser does NOT consume this — it consumes
    // the structured pavillion:place content[lang].name instead — so the
    // restored.location.name above must stay 'Convention Center', not the
    // concatenation. This pair of assertions guards against a regression
    // where the inbound parser starts reading the flat name (which would
    // pollute restored Place names with the Space name on every round trip).
    expect(apObject.location.type).toBe('Place');
    expect(apObject.location.name).toBe('Convention Center — Pacific Room');

    // --- Space restoration ---
    expect(restored.space, 'restored.space must be present after round-trip').not.toBeNull();
    expect(restored.space, 'restored.space must be present after round-trip').toBeDefined();
    expect(restored.space.content, 'restored.space.content must be present').toBeDefined();

    // Per-language Space content survives. Unlike Place names, Space names
    // are translatable today, so each language entry carries its own name
    // alongside its own accessibilityInfo.
    expect(restored.space.content.en).toBeDefined();
    expect(restored.space.content.fr).toBeDefined();
    expect(restored.space.content.en.name).toBe('Pacific Room');
    expect(restored.space.content.en.accessibilityInfo).toBe('Hearing loop');
    expect(restored.space.content.fr.name).toBe('Salle Pacifique');
    expect(restored.space.content.fr.accessibilityInfo).toBe('Boucle auditive');

    // --- Identity preservation across the round trip ---
    // The pavillion:place and pavillion:space ids on the wire become
    // originUri stamps on the restored entries (dedup-by-origin_uri path).
    // The space id MUST be anchored under the place id segment so the
    // inbound parent-path prefix check (`${placeId}/spaces/`) passes; if the
    // outbound emitter ever drifts away from that nesting, the inbound
    // parser drops the Space and this assertion fails.
    expect(restored.location.originUri).toBe(apObject['pavillion:place'].id);
    expect(restored.space.originUri).toBe(apObject['pavillion:space'].id);
    expect(restored.space.originUri.startsWith(`${restored.location.originUri}/spaces/`)).toBe(true);
  });
});
