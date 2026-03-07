import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import ModerationService from '@/server/moderation/service/moderation';
import { ReportEntity } from '@/server/moderation/entity/report';

describe('ModerationService.acknowledgeForwardedReport', () => {
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

  it('should return false when no report found for the given forwarded report ID', async () => {
    sandbox.stub(ReportEntity, 'findOne').resolves(null);

    const result = await service.acknowledgeForwardedReport('https://remote.instance/flags/unknown-id');

    expect(result).toBe(false);
  });

  it('should return true and update forward_status when report is found', async () => {
    const updateStub = sandbox.stub().resolves();
    const mockEntity = {
      id: 'report-uuid',
      forward_status: 'pending',
      update: updateStub,
    };
    sandbox.stub(ReportEntity, 'findOne').resolves(mockEntity as any);

    const result = await service.acknowledgeForwardedReport('https://remote.instance/flags/flag-id');

    expect(result).toBe(true);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.calledWith({ forward_status: 'acknowledged' })).toBe(true);
  });

  it('should call findOne with the correct where clause', async () => {
    const findOneStub = sandbox.stub(ReportEntity, 'findOne').resolves(null);

    await service.acknowledgeForwardedReport('https://remote.instance/flags/specific-id');

    expect(findOneStub.calledOnce).toBe(true);
    expect(findOneStub.firstCall.args[0]).toEqual({
      where: { forwarded_report_id: 'https://remote.instance/flags/specific-id' },
    });
  });
});
