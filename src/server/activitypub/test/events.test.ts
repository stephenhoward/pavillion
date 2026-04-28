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
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { setupActivityPubSchema, teardownActivityPubSchema } from '@/server/common/test/helpers/database';

describe('inbox event listener', () => {
  let service: ActivityPubInterface;
  let eventHandler: ActivityPubEventHandlers;
  let eventBus: EventEmitter;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach (() => {
    eventBus = new EventEmitter();
    service = new ActivityPubInterface(eventBus);
    eventHandler = new ActivityPubEventHandlers(service, new CalendarInterface(eventBus));
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
    eventHandler = new ActivityPubEventHandlers(service, new CalendarInterface(eventBus));
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
    eventHandler = new ActivityPubEventHandlers(service, new CalendarInterface(eventBus));
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

  it('should broadcast update when payload.calendar is present (local event update)', async () => {
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
    expect(addToOutboxStub.calledOnce).toBe(true);

    const outboxCall = addToOutboxStub.getCall(0);
    expect(outboxCall.args[0]).toBe(calendar);
    expect(outboxCall.args[1].type).toBe('Update');
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
    handlers = new ActivityPubEventHandlers(service, new CalendarInterface(eventBus));
    handlers.install(eventBus);
  });

  afterEach(async () => {
    sandbox.restore();
    await teardownActivityPubSchema();
  });

  it('creates an EventObjectEntity for the local event before dispatching Announce', async () => {
    const calendar = Calendar.fromObject({ id: uuidv4(), urlName: 'my_calendar' });
    const event = CalendarEvent.fromObject({ id: uuidv4() });
    const actorUrl = ActivityPubActor.actorUrl(calendar);

    // Stub the service methods that would otherwise hit the database / network
    sandbox.stub(service, 'actorUrl').resolves(actorUrl);
    const addToOutboxStub = sandbox.stub(service, 'addToOutbox').resolves();

    // Invoke the private handler directly so we can deterministically assert
    // on the persisted EventObjectEntity row.
    await (handlers as any)['handleEventCreated']({ calendar, event });

    const eventObject = await EventObjectEntity.findOne({ where: { event_id: event.id } });
    expect(eventObject, 'EventObjectEntity must exist for local event').not.toBeNull();
    expect(eventObject!.attributed_to).toBe(actorUrl);
    expect(addToOutboxStub.calledOnce).toBe(true);
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
    // a signal, not a hard stop.
    expect(
      addToOutboxStub.calledOnce,
      'addToOutbox must still be called so the event reaches federation',
    ).toBe(true);
  });

  it('returns early without dispatching Announce when payload.calendar is null (remote-origin event, pv-13xg)', async () => {
    // EventService.addRemoteEvent emits eventCreated with calendar:null so the
    // calendar-domain buildEventInstances handler materializes canonical rows
    // for inbound federated events. The AP handler must early-return on the
    // same payload — without this guard, the handler would call
    // EventObject.eventUrl(null, ...) (crash) and addToOutbox(null, ...)
    // (re-Announce a remote event back to federation, creating a loop).
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
