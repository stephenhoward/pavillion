import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Calendar } from '@/common/model/calendar';
import ProcessInboxService from '@/server/activitypub/service/inbox';
import { ActivityPubInboxMessageEntity } from '@/server/activitypub/entity/activitypub';


describe('processInboxMessage', () => {
  let service: ProcessInboxService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let getCalendarStub: sinon.SinonStub;

  beforeEach (() => {
    const eventBus = new EventEmitter();
    service = new ProcessInboxService(eventBus);
    getCalendarStub = sandbox.stub(service.calendarService,'getCalendar');
    getCalendarStub.resolves(Calendar.fromObject({ id: 'testid' }));
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should fail without calendar', async () => {
    let message = ActivityPubInboxMessageEntity.build({ calendar_id: 'testid', type: 'Create', message: { to: 'remoteaccount@remotedomain' } });
    let updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype,'update');

    getCalendarStub.resolves(null);

    await service.processInboxMessage(message);

    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('error');
  });

  it('should skip invalid message type', async () => {
    let message = ActivityPubInboxMessageEntity.build({ calendar_id: 'testid', type: 'NotAType', message: { to: 'remoteaccount@remotedomain' } });
    let updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype,'update');

    await service.processInboxMessage(message);

    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('error');
  });

  it('should process a create activity', async () => {
    let message = ActivityPubInboxMessageEntity.build({ calendar_id: 'testid', type: 'Create', message: { object: { id: 'testid' } } });
    let processStub = sandbox.stub(service,'processCreateEvent');
    let updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype,'update');

    await service.processInboxMessage(message);

    expect(processStub.called).toBe(true);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  it('should process an update activity', async () => {
    let message = ActivityPubInboxMessageEntity.build({ calendar_id: 'testid', type: 'Update', message: { object: { id: 'testid' } } });
    let processStub = sandbox.stub(service,'processUpdateEvent');
    let updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype,'update');

    await service.processInboxMessage(message);

    expect(processStub.called).toBe(true);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  it('should process a delete activity', async () => {
    let message = ActivityPubInboxMessageEntity.build({ calendar_id: 'testid', type: 'Delete', message: { object: { id: 'testid' } } });
    let processStub = sandbox.stub(service,'processDeleteEvent');
    let updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype,'update');

    await service.processInboxMessage(message);

    expect(processStub.called).toBe(true);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  it('should process a follow activity', async () => {
    let message = ActivityPubInboxMessageEntity.build({ calendar_id: 'testid', type: 'Follow', message: { object: { id: 'testid' } } });
    let processStub = sandbox.stub(service,'processFollowAccount');
    let updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype,'update');

    await service.processInboxMessage(message);

    expect(processStub.called).toBe(true);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  it('should process an announce activity', async () => {
    let message = ActivityPubInboxMessageEntity.build({ calendar_id: 'testid', type: 'Announce', message: { object: { id: 'testid' } } });
    let processStub = sandbox.stub(service,'processShareEvent');
    let updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype,'update');

    await service.processInboxMessage(message);

    expect(processStub.called).toBe(true);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  it('should error an undo activity with no target', async () => {
    let message = ActivityPubInboxMessageEntity.build({ calendar_id: 'testid', type: 'Undo', message: { object: { type: 'Follow' } } });
    let processStub = sandbox.stub(service,'processUnfollowAccount');
    let targetStub = sandbox.stub(ActivityPubInboxMessageEntity,'findOne');
    let updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype,'update');

    targetStub.resolves(undefined);

    await service.processInboxMessage(message);

    expect(processStub.called).toBe(false);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('error');
  });

  it('should process an undo follow activity', async () => {
    let message = ActivityPubInboxMessageEntity.build({ calendar_id: 'testid', type: 'Undo', message: { object: { type: 'Follow' } } });
    let processStub = sandbox.stub(service,'processUnfollowAccount');
    let targetStub = sandbox.stub(ActivityPubInboxMessageEntity,'findOne');
    let updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype,'update');

    targetStub.resolves(ActivityPubInboxMessageEntity.build({ calendar_id: 'testid', type: 'Follow' }));

    await service.processInboxMessage(message);

    expect(processStub.called).toBe(true);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });

  it('should process an undo announce activity', async () => {
    let message = ActivityPubInboxMessageEntity.build({ calendar_id: 'testid', type: 'Undo', message: { object: { type: 'Announce' } } });
    let processStub = sandbox.stub(service,'processUnshareEvent');
    let targetStub = sandbox.stub(ActivityPubInboxMessageEntity,'findOne');
    let updateStub = sandbox.stub(ActivityPubInboxMessageEntity.prototype,'update');

    targetStub.resolves(ActivityPubInboxMessageEntity.build({ calendar_id: 'testid', type: 'Announce' }));

    await service.processInboxMessage(message);

    expect(processStub.called).toBe(true);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.getCalls()[0].args[0]['processed_time']).toBeDefined();
    expect(updateStub.getCalls()[0].args[0]['processed_status']).toBe('ok');
  });
});
