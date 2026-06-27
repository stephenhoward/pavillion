import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import ModerationService from '@/server/moderation/service/moderation';
import { ReportEntity } from '@/server/moderation/entity/report';
import { ForwardStatus } from '@/common/model/report';

describe('ModerationService.checkForwardStatus', () => {
  let sandbox: sinon.SinonSandbox;
  let service: ModerationService;
  let eventBus: EventEmitter;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    service = new ModerationService(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return null if report not found', async () => {
    sandbox.stub(ReportEntity, 'findByPk').resolves(null);

    const status = await service.checkForwardStatus('nonexistent-report-id');

    expect(status).toBeNull();
  });

  it('should return null if report has no forward_status', async () => {
    const mockEntity = {
      forward_status: null,
    };
    sandbox.stub(ReportEntity, 'findByPk').resolves(mockEntity as any);

    const status = await service.checkForwardStatus('report-id');

    expect(status).toBeNull();
  });

  it('should return "pending" status', async () => {
    const mockEntity = {
      forward_status: ForwardStatus.PENDING,
    };
    sandbox.stub(ReportEntity, 'findByPk').resolves(mockEntity as any);

    const status = await service.checkForwardStatus('report-id');

    expect(status).toBe('pending');
    expect(status).toBe(ForwardStatus.PENDING);
  });

  it('should return "acknowledged" status', async () => {
    const mockEntity = {
      forward_status: ForwardStatus.ACKNOWLEDGED,
    };
    sandbox.stub(ReportEntity, 'findByPk').resolves(mockEntity as any);

    const status = await service.checkForwardStatus('report-id');

    expect(status).toBe(ForwardStatus.ACKNOWLEDGED);
  });

  it('should return "no_response" status', async () => {
    const mockEntity = {
      forward_status: ForwardStatus.NO_RESPONSE,
    };
    sandbox.stub(ReportEntity, 'findByPk').resolves(mockEntity as any);

    const status = await service.checkForwardStatus('report-id');

    expect(status).toBe(ForwardStatus.NO_RESPONSE);
  });
});
