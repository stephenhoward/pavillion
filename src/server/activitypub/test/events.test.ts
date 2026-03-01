import { EventEmitter } from 'events';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import ActivityPubEventHandlers from '@/server/activitypub/events';
import ActivityPubInterface from '@/server/activitypub/interface';
import { ActivityPubInboxMessageEntity, ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';

describe('inbox event listener', () => {
  let service: ActivityPubInterface;
  let eventHandler: ActivityPubEventHandlers;
  let eventBus: EventEmitter;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach (() => {
    eventBus = new EventEmitter();
    service = new ActivityPubInterface(eventBus);
    eventHandler = new ActivityPubEventHandlers(service);
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
    eventHandler = new ActivityPubEventHandlers(service);
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
    eventHandler = new ActivityPubEventHandlers(service);
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
