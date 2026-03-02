import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { Op } from 'sequelize';

import ProcessInboxService from '@/server/activitypub/service/inbox';
import { ActivityPubInboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import CalendarInterface from '@/server/calendar/interface';

describe('ProcessInboxService.cleanupProcessedInboxMessages', () => {
  let sandbox: sinon.SinonSandbox;
  let service: ProcessInboxService;
  let destroyStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    service = new ProcessInboxService(eventBus, calendarInterface);
    destroyStub = sandbox.stub(ActivityPubInboxMessageEntity, 'destroy').resolves(0);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('deletes old processed messages and returns deletion count', async () => {
    destroyStub.resolves(5);

    const result = await service.cleanupProcessedInboxMessages(30, 1000);

    expect(result).toBe(5);
    expect(destroyStub.calledOnce).toBe(true);

    const whereArg = destroyStub.getCall(0).args[0].where;
    expect(whereArg.type[Op.notIn]).toContain('Follow');
    expect(whereArg.type[Op.notIn]).toContain('Announce');
  });

  it('keeps unprocessed messages (processed_time: null)', async () => {
    await service.cleanupProcessedInboxMessages(30, 1000);

    const whereArg = destroyStub.getCall(0).args[0].where;
    expect(whereArg.processed_time[Op.ne]).toBeNull();
  });

  it('keeps recently processed messages using Op.lt with cutoff date', async () => {
    const retentionDays = 30;
    const before = new Date();
    before.setDate(before.getDate() - retentionDays);

    await service.cleanupProcessedInboxMessages(retentionDays, 1000);

    const whereArg = destroyStub.getCall(0).args[0].where;
    const cutoffDate: Date = whereArg.processed_time[Op.lt];

    expect(cutoffDate).toBeInstanceOf(Date);

    const after = new Date();
    after.setDate(after.getDate() - retentionDays);

    // Cutoff should be approximately 30 days ago (within a few seconds of test execution)
    expect(cutoffDate.getTime()).toBeGreaterThanOrEqual(before.getTime() - 5000);
    expect(cutoffDate.getTime()).toBeLessThanOrEqual(after.getTime() + 5000);
  });

  it('excludes Follow and Announce types regardless of age', async () => {
    await service.cleanupProcessedInboxMessages(0, 1000);

    const whereArg = destroyStub.getCall(0).args[0].where;
    expect(whereArg.type[Op.notIn]).toContain('Follow');
    expect(whereArg.type[Op.notIn]).toContain('Announce');
  });

  it('respects batch size limit', async () => {
    const batchSize = 100;

    await service.cleanupProcessedInboxMessages(30, batchSize);

    const callArgs = destroyStub.getCall(0).args[0];
    expect(callArgs.limit).toBe(batchSize);
  });

  it('returns correct deletion count', async () => {
    destroyStub.resolves(42);

    const result = await service.cleanupProcessedInboxMessages(30, 1000);

    expect(result).toBe(42);
  });
});
