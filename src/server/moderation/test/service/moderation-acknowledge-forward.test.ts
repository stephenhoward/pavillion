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

  it('should return false when forwardedReportId is empty', async () => {
    const findOneStub = sandbox.stub(ReportEntity, 'findOne');

    const result = await service.acknowledgeForwardedReport('', 'https://remote.instance/calendars/remote');

    expect(result).toBe(false);
    expect(findOneStub.called).toBe(false);
  });

  it('should return false when forwardedReportId is not a valid URI', async () => {
    const findOneStub = sandbox.stub(ReportEntity, 'findOne');

    const result = await service.acknowledgeForwardedReport('not-a-uri', 'https://remote.instance/calendars/remote');

    expect(result).toBe(false);
    expect(findOneStub.called).toBe(false);
  });

  it('should return false when no report found for the given forwarded report ID', async () => {
    sandbox.stub(ReportEntity, 'findOne').resolves(null);

    const result = await service.acknowledgeForwardedReport(
      'https://remote.instance/flags/unknown-id',
      'https://remote.instance/calendars/remote',
    );

    expect(result).toBe(false);
  });

  it('should return true and update forward_status when sender hostname matches target', async () => {
    const updateStub = sandbox.stub().resolves();
    const mockEntity = {
      id: 'report-uuid',
      forward_status: 'pending',
      forwarded_to_actor_uri: 'https://remote.instance/calendars/target-calendar',
      update: updateStub,
    };
    sandbox.stub(ReportEntity, 'findOne').resolves(mockEntity as any);

    const result = await service.acknowledgeForwardedReport(
      'https://local.instance/flags/flag-id',
      'https://remote.instance/calendars/sender-calendar',
    );

    expect(result).toBe(true);
    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.calledWith({ forward_status: 'acknowledged' })).toBe(true);
  });

  it('should return false when sender hostname does not match target hostname', async () => {
    const updateStub = sandbox.stub().resolves();
    const mockEntity = {
      id: 'report-uuid',
      forward_status: 'pending',
      forwarded_to_actor_uri: 'https://expected.instance/calendars/target',
      update: updateStub,
    };
    sandbox.stub(ReportEntity, 'findOne').resolves(mockEntity as any);

    const result = await service.acknowledgeForwardedReport(
      'https://local.instance/flags/flag-id',
      'https://attacker.instance/calendars/impersonator',
    );

    expect(result).toBe(false);
    expect(updateStub.called).toBe(false);
  });

  it('should return true without updating when already acknowledged (idempotency)', async () => {
    const updateStub = sandbox.stub().resolves();
    const mockEntity = {
      id: 'report-uuid',
      forward_status: 'acknowledged',
      forwarded_to_actor_uri: 'https://remote.instance/calendars/target',
      update: updateStub,
    };
    sandbox.stub(ReportEntity, 'findOne').resolves(mockEntity as any);

    const result = await service.acknowledgeForwardedReport(
      'https://local.instance/flags/flag-id',
      'https://remote.instance/calendars/sender',
    );

    expect(result).toBe(true);
    expect(updateStub.called).toBe(false);
  });

  it('should return false when already acknowledged but sender hostname does not match', async () => {
    const updateStub = sandbox.stub().resolves();
    const mockEntity = {
      id: 'report-uuid',
      forward_status: 'acknowledged',
      forwarded_to_actor_uri: 'https://legitimate.instance/calendars/target',
      update: updateStub,
    };
    sandbox.stub(ReportEntity, 'findOne').resolves(mockEntity as any);

    const result = await service.acknowledgeForwardedReport(
      'https://local.instance/flags/flag-id',
      'https://attacker.instance/calendars/probe',
    );

    expect(result).toBe(false);
    expect(updateStub.called).toBe(false);
  });

  it('should return false when forwarded_to_actor_uri is null (legacy records)', async () => {
    const updateStub = sandbox.stub().resolves();
    const mockEntity = {
      id: 'report-uuid',
      forward_status: 'pending',
      forwarded_to_actor_uri: null,
      update: updateStub,
    };
    sandbox.stub(ReportEntity, 'findOne').resolves(mockEntity as any);

    const result = await service.acknowledgeForwardedReport(
      'https://local.instance/flags/flag-id',
      'https://remote.instance/calendars/sender',
    );

    expect(result).toBe(false);
    expect(updateStub.called).toBe(false);
  });

  it('should query by forwarded_report_id when format is valid', async () => {
    const findOneStub = sandbox.stub(ReportEntity, 'findOne').resolves(null);

    await service.acknowledgeForwardedReport(
      'https://remote.instance/flags/specific-id',
      'https://remote.instance/calendars/sender',
    );

    expect(findOneStub.calledOnce).toBe(true);
    expect(findOneStub.firstCall.args[0]).toEqual({
      where: { forwarded_report_id: 'https://remote.instance/flags/specific-id' },
    });
  });

  it('should return false when senderActorUri is malformed', async () => {
    const updateStub = sandbox.stub().resolves();
    const mockEntity = {
      id: 'report-uuid',
      forward_status: 'pending',
      forwarded_to_actor_uri: 'https://remote.instance/calendars/target',
      update: updateStub,
    };
    sandbox.stub(ReportEntity, 'findOne').resolves(mockEntity as any);

    const result = await service.acknowledgeForwardedReport(
      'https://local.instance/flags/flag-id',
      'not-a-valid-uri',
    );

    expect(result).toBe(false);
    expect(updateStub.called).toBe(false);
  });

  it('should return false when forwardedReportId uses javascript: scheme', async () => {
    const findOneStub = sandbox.stub(ReportEntity, 'findOne');

    const result = await service.acknowledgeForwardedReport(
      'javascript:alert(1)',
      'https://remote.instance/calendars/remote',
    );

    expect(result).toBe(false);
    expect(findOneStub.called).toBe(false);
  });

  it('should return false when forwardedReportId uses data: scheme', async () => {
    const findOneStub = sandbox.stub(ReportEntity, 'findOne');

    const result = await service.acknowledgeForwardedReport(
      'data:text/html,<h1>test</h1>',
      'https://remote.instance/calendars/remote',
    );

    expect(result).toBe(false);
    expect(findOneStub.called).toBe(false);
  });

  it('should return false when forwardedReportId uses file: scheme', async () => {
    const findOneStub = sandbox.stub(ReportEntity, 'findOne');

    const result = await service.acknowledgeForwardedReport(
      'file:///etc/passwd',
      'https://remote.instance/calendars/remote',
    );

    expect(result).toBe(false);
    expect(findOneStub.called).toBe(false);
  });

  it('should return false when senderActorUri uses non-https scheme', async () => {
    const updateStub = sandbox.stub().resolves();
    const mockEntity = {
      id: 'report-uuid',
      forward_status: 'pending',
      forwarded_to_actor_uri: 'https://remote.instance/calendars/target',
      update: updateStub,
    };
    sandbox.stub(ReportEntity, 'findOne').resolves(mockEntity as any);

    const result = await service.acknowledgeForwardedReport(
      'https://local.instance/flags/flag-id',
      'javascript:void(0)',
    );

    expect(result).toBe(false);
    expect(updateStub.called).toBe(false);
  });
});
