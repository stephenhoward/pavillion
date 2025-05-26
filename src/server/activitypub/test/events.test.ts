import { EventEmitter } from 'events';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import ActivityPubEventHandlers from '@/server/activitypub/events';
import ActivityPubInterface from '@/server/activitypub/interface';
import { ActivityPubInboxMessageEntity, ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';

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
