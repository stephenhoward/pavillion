import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import ModerationService from '@/server/moderation/service/moderation';
import { ReportEntity } from '@/server/moderation/entity/report';
import { Report, ReportStatus } from '@/common/model/report';

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
      forward_status: 'pending',
    };
    sandbox.stub(ReportEntity, 'findByPk').resolves(mockEntity as any);

    const status = await service.checkForwardStatus('report-id');

    expect(status).toBe('pending');
  });

  it('should return "acknowledged" status', async () => {
    const mockEntity = {
      forward_status: 'acknowledged',
    };
    sandbox.stub(ReportEntity, 'findByPk').resolves(mockEntity as any);

    const status = await service.checkForwardStatus('report-id');

    expect(status).toBe('acknowledged');
  });

  it('should return "no_response" status', async () => {
    const mockEntity = {
      forward_status: 'no_response',
    };
    sandbox.stub(ReportEntity, 'findByPk').resolves(mockEntity as any);

    const status = await service.checkForwardStatus('report-id');

    expect(status).toBe('no_response');
  });
});
