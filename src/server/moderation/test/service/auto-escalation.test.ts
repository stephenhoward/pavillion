import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Report, ReportCategory, ReportStatus } from '@/common/model/report';
import { ReportEntity } from '@/server/moderation/entity/report';
import ModerationService from '@/server/moderation/service/moderation';
import ConfigurationInterface from '@/server/configuration/interface';

const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('ModerationService - Auto-Escalation', () => {
  let sandbox: sinon.SinonSandbox;
  let service: ModerationService;
  let eventBus: EventEmitter;
  let configInterface: ConfigurationInterface;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    configInterface = new ConfigurationInterface();
    service = new ModerationService(eventBus, undefined, configInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('checkAutoEscalation', () => {

    it('should return 0 when threshold is 0 (auto-escalation disabled)', async () => {
      // Mock configuration to return threshold of 0
      sandbox.stub(configInterface, 'getSetting').resolves('0');

      // Mock reports
      const mockReports = [
        { status: ReportStatus.SUBMITTED },
        { status: ReportStatus.SUBMITTED },
        { status: ReportStatus.SUBMITTED },
      ];
      sandbox.stub(ReportEntity, 'findAll').resolves(mockReports as any);

      const result = await service.checkAutoEscalation(VALID_UUID);

      expect(result).toBe(0);
    });

    it('should return 0 when report count is below threshold', async () => {
      // Mock configuration to return threshold of 5
      sandbox.stub(configInterface, 'getSetting').resolves('5');

      // Mock 3 reports (below threshold of 5)
      const mockReports = [
        { id: '1', status: ReportStatus.SUBMITTED, update: sandbox.stub().resolves() },
        { id: '2', status: ReportStatus.SUBMITTED, update: sandbox.stub().resolves() },
        { id: '3', status: ReportStatus.SUBMITTED, update: sandbox.stub().resolves() },
      ];
      sandbox.stub(ReportEntity, 'findAll').resolves(mockReports as any);
      sandbox.stub(ReportEntity, 'count').resolves(3);

      const result = await service.checkAutoEscalation(VALID_UUID);

      expect(result).toBe(0);
    });

    it('should escalate pending reports when threshold is reached', async () => {
      // Mock configuration to return threshold of 3
      sandbox.stub(configInterface, 'getSetting').resolves('3');

      // Mock 3 reports (meets threshold)
      const mockReports = [
        { id: '1', event_id: VALID_UUID, status: ReportStatus.SUBMITTED, update: sandbox.stub().resolves(), toModel: () => new Report('1') },
        { id: '2', event_id: VALID_UUID, status: ReportStatus.SUBMITTED, update: sandbox.stub().resolves(), toModel: () => new Report('2') },
        { id: '3', event_id: VALID_UUID, status: ReportStatus.SUBMITTED, update: sandbox.stub().resolves(), toModel: () => new Report('3') },
      ];
      sandbox.stub(ReportEntity, 'findAll').resolves(mockReports as any);
      sandbox.stub(ReportEntity, 'count').resolves(3);

      // Mock escalation record creation
      const mockFromModel = sandbox.stub().returns({ save: sandbox.stub().resolves() });
      sandbox.stub(await import('@/server/moderation/entity/report_escalation'), 'ReportEscalationEntity').value({
        fromModel: mockFromModel,
      });

      const result = await service.checkAutoEscalation(VALID_UUID);

      expect(result).toBe(3);
      expect(mockReports[0].update.calledOnce).toBe(true);
      expect(mockReports[1].update.calledOnce).toBe(true);
      expect(mockReports[2].update.calledOnce).toBe(true);
    });

    it('should only escalate reports in pending or owner_review status', async () => {
      // Mock configuration to return threshold of 3
      sandbox.stub(configInterface, 'getSetting').resolves('3');

      // Mock 5 reports with mixed statuses
      const mockReports = [
        { id: '1', event_id: VALID_UUID, status: ReportStatus.SUBMITTED, update: sandbox.stub().resolves(), toModel: () => new Report('1') },
        { id: '2', event_id: VALID_UUID, status: ReportStatus.UNDER_REVIEW, update: sandbox.stub().resolves(), toModel: () => new Report('2') },
        { id: '3', event_id: VALID_UUID, status: ReportStatus.ESCALATED, update: sandbox.stub().resolves(), toModel: () => new Report('3') },
        { id: '4', event_id: VALID_UUID, status: ReportStatus.RESOLVED, update: sandbox.stub().resolves(), toModel: () => new Report('4') },
        { id: '5', event_id: VALID_UUID, status: ReportStatus.DISMISSED, update: sandbox.stub().resolves(), toModel: () => new Report('5') },
      ];
      sandbox.stub(ReportEntity, 'findAll').resolves(mockReports.slice(0, 2) as any); // Only pending/owner_review
      sandbox.stub(ReportEntity, 'count').resolves(5); // Total count

      // Mock escalation record creation
      const mockFromModel = sandbox.stub().returns({ save: sandbox.stub().resolves() });
      sandbox.stub(await import('@/server/moderation/entity/report_escalation'), 'ReportEscalationEntity').value({
        fromModel: mockFromModel,
      });

      const result = await service.checkAutoEscalation(VALID_UUID);

      expect(result).toBe(2);
      expect(mockReports[0].update.calledOnce).toBe(true);
      expect(mockReports[1].update.calledOnce).toBe(true);
      expect(mockReports[2].update.called).toBe(false);
      expect(mockReports[3].update.called).toBe(false);
      expect(mockReports[4].update.called).toBe(false);
    });

    it('should not re-escalate already escalated reports', async () => {
      // Mock configuration to return threshold of 2
      sandbox.stub(configInterface, 'getSetting').resolves('2');

      // Mock reports - all already escalated
      const mockReports: any[] = [];
      sandbox.stub(ReportEntity, 'findAll').resolves(mockReports);
      sandbox.stub(ReportEntity, 'count').resolves(3);

      const result = await service.checkAutoEscalation(VALID_UUID);

      expect(result).toBe(0);
    });

    it('should use default threshold of 5 when configuration is not set', async () => {
      // Mock configuration to return undefined (no setting)
      sandbox.stub(configInterface, 'getSetting').resolves(undefined);

      // Mock 5 reports (meets default threshold)
      const mockReports = [
        { id: '1', event_id: VALID_UUID, status: ReportStatus.SUBMITTED, update: sandbox.stub().resolves(), toModel: () => new Report('1') },
        { id: '2', event_id: VALID_UUID, status: ReportStatus.SUBMITTED, update: sandbox.stub().resolves(), toModel: () => new Report('2') },
        { id: '3', event_id: VALID_UUID, status: ReportStatus.SUBMITTED, update: sandbox.stub().resolves(), toModel: () => new Report('3') },
        { id: '4', event_id: VALID_UUID, status: ReportStatus.SUBMITTED, update: sandbox.stub().resolves(), toModel: () => new Report('4') },
        { id: '5', event_id: VALID_UUID, status: ReportStatus.SUBMITTED, update: sandbox.stub().resolves(), toModel: () => new Report('5') },
      ];
      sandbox.stub(ReportEntity, 'findAll').resolves(mockReports as any);
      sandbox.stub(ReportEntity, 'count').resolves(5);

      // Mock escalation record creation
      const mockFromModel = sandbox.stub().returns({ save: sandbox.stub().resolves() });
      sandbox.stub(await import('@/server/moderation/entity/report_escalation'), 'ReportEscalationEntity').value({
        fromModel: mockFromModel,
      });

      const result = await service.checkAutoEscalation(VALID_UUID);

      expect(result).toBe(5);
    });

    it('should emit reportEscalated event for each auto-escalated report', async () => {
      // Mock configuration to return threshold of 2
      sandbox.stub(configInterface, 'getSetting').resolves('2');

      // Mock 2 reports
      const report1 = new Report('1');
      report1.eventId = VALID_UUID;
      report1.status = ReportStatus.SUBMITTED;

      const report2 = new Report('2');
      report2.eventId = VALID_UUID;
      report2.status = ReportStatus.SUBMITTED;

      const mockReports = [
        { id: '1', event_id: VALID_UUID, status: ReportStatus.SUBMITTED, update: sandbox.stub().resolves(), toModel: () => report1 },
        { id: '2', event_id: VALID_UUID, status: ReportStatus.SUBMITTED, update: sandbox.stub().resolves(), toModel: () => report2 },
      ];
      sandbox.stub(ReportEntity, 'findAll').resolves(mockReports as any);
      sandbox.stub(ReportEntity, 'count').resolves(2);

      // Mock escalation record creation
      const mockFromModel = sandbox.stub().returns({ save: sandbox.stub().resolves() });
      sandbox.stub(await import('@/server/moderation/entity/report_escalation'), 'ReportEscalationEntity').value({
        fromModel: mockFromModel,
      });

      const emitSpy = sandbox.spy(eventBus, 'emit');

      const result = await service.checkAutoEscalation(VALID_UUID);

      expect(result).toBe(2);
      expect(emitSpy.callCount).toBe(2);
      expect(emitSpy.firstCall.args[0]).toBe('reportEscalated');
      expect(emitSpy.secondCall.args[0]).toBe('reportEscalated');
    });

    it('should create escalation records with correct metadata', async () => {
      // Mock configuration to return threshold of 2
      sandbox.stub(configInterface, 'getSetting').resolves('2');

      // Mock 2 reports
      const report1 = new Report('1');
      report1.eventId = VALID_UUID;
      report1.status = ReportStatus.SUBMITTED;

      const mockReports = [
        { id: '1', event_id: VALID_UUID, status: ReportStatus.SUBMITTED, update: sandbox.stub().resolves(), toModel: () => report1 },
      ];
      sandbox.stub(ReportEntity, 'findAll').resolves(mockReports as any);
      sandbox.stub(ReportEntity, 'count').resolves(2);

      // Mock escalation record creation
      const mockSave = sandbox.stub().resolves();
      const mockFromModel = sandbox.stub().returns({ save: mockSave });
      sandbox.stub(await import('@/server/moderation/entity/report_escalation'), 'ReportEscalationEntity').value({
        fromModel: mockFromModel,
      });

      await service.checkAutoEscalation(VALID_UUID);

      expect(mockFromModel.calledOnce).toBe(true);
      const escalationData = mockFromModel.firstCall.args[0];
      expect(escalationData.reportId).toBe('1');
      expect(escalationData.fromStatus).toBe(ReportStatus.SUBMITTED);
      expect(escalationData.toStatus).toBe(ReportStatus.ESCALATED);
      expect(escalationData.reviewerRole).toBe('system');
      expect(escalationData.decision).toBe('auto-escalated');
      expect(escalationData.notes).toContain('threshold');
    });
  });
});
