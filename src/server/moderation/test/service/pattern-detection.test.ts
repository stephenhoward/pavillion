import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { Op } from 'sequelize';

import { PatternDetectionService } from '@/server/moderation/service/pattern-detection';
import { ReportEntity } from '@/server/moderation/entity/report';

describe('PatternDetectionService', () => {
  let service: PatternDetectionService;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new PatternDetectionService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('detectSourceFlooding', () => {
    it('should detect multiple reports from same email hash targeting different events', async () => {
      const reporterId = 'test-reporter-id';
      const reporterEmailHash = 'hash-abc123';

      // Mock finding the source report
      const sourceReport = ReportEntity.build({
        id: reporterId,
        event_id: 'event-1',
        calendar_id: 'cal-1',
        category: 'spam',
        description: 'Test report',
        reporter_email_hash: reporterEmailHash,
        reporter_account_id: null,
        reporter_type: 'anonymous',
        status: 'submitted',
        created_at: new Date('2026-02-10T10:00:00Z'),
      });

      // Mock finding other reports from same source
      const otherReports = [
        ReportEntity.build({
          id: 'report-2',
          event_id: 'event-2',
          calendar_id: 'cal-1',
          category: 'spam',
          description: 'Another report',
          reporter_email_hash: reporterEmailHash,
          reporter_account_id: null,
          reporter_type: 'anonymous',
          status: 'submitted',
          created_at: new Date('2026-02-10T11:00:00Z'),
        }),
        ReportEntity.build({
          id: 'report-3',
          event_id: 'event-3',
          calendar_id: 'cal-1',
          category: 'spam',
          description: 'Yet another report',
          reporter_email_hash: reporterEmailHash,
          reporter_account_id: null,
          reporter_type: 'anonymous',
          status: 'submitted',
          created_at: new Date('2026-02-10T12:00:00Z'),
        }),
      ];

      const findByPkStub = sandbox.stub(ReportEntity, 'findByPk');
      findByPkStub.resolves(sourceReport);

      const countStub = sandbox.stub(ReportEntity, 'count');
      countStub.resolves(3); // Including source report

      const result = await service.detectSourceFlooding(reporterId);

      expect(result.type).toBe('source_flooding');
      expect(result.count).toBe(3);
      expect(result.threshold).toBe(3);
      expect(result.severity).toBe('high');
      expect(findByPkStub.calledOnce).toBe(true);
      expect(countStub.calledOnce).toBe(true);
    });

    it('should detect reports from same authenticated account', async () => {
      const reporterId = 'test-reporter-id';
      const reporterAccountId = 'account-123';

      const sourceReport = ReportEntity.build({
        id: reporterId,
        event_id: 'event-1',
        calendar_id: 'cal-1',
        category: 'spam',
        description: 'Test report',
        reporter_email_hash: null,
        reporter_account_id: reporterAccountId,
        reporter_type: 'authenticated',
        status: 'submitted',
        created_at: new Date('2026-02-10T10:00:00Z'),
      });

      const findByPkStub = sandbox.stub(ReportEntity, 'findByPk');
      findByPkStub.resolves(sourceReport);

      const countStub = sandbox.stub(ReportEntity, 'count');
      countStub.resolves(4);

      const result = await service.detectSourceFlooding(reporterId);

      expect(result.type).toBe('source_flooding');
      expect(result.count).toBe(4);
      expect(result.severity).toBe('high');
    });

    it('should return low severity when count is below threshold', async () => {
      const reporterId = 'test-reporter-id';
      const reporterEmailHash = 'hash-abc123';

      const sourceReport = ReportEntity.build({
        id: reporterId,
        event_id: 'event-1',
        calendar_id: 'cal-1',
        category: 'spam',
        description: 'Test report',
        reporter_email_hash: reporterEmailHash,
        reporter_account_id: null,
        reporter_type: 'anonymous',
        status: 'submitted',
        created_at: new Date('2026-02-10T10:00:00Z'),
      });

      const findByPkStub = sandbox.stub(ReportEntity, 'findByPk');
      findByPkStub.resolves(sourceReport);

      const countStub = sandbox.stub(ReportEntity, 'count');
      countStub.resolves(2);

      const result = await service.detectSourceFlooding(reporterId);

      expect(result.type).toBe('source_flooding');
      expect(result.count).toBe(2);
      expect(result.severity).toBe('low');
    });

    it('should return null when report not found', async () => {
      const findByPkStub = sandbox.stub(ReportEntity, 'findByPk');
      findByPkStub.resolves(null);

      const result = await service.detectSourceFlooding('non-existent');

      expect(result).toBeNull();
    });

    it('should return null when reporter has no identifier', async () => {
      const sourceReport = ReportEntity.build({
        id: 'test-id',
        event_id: 'event-1',
        calendar_id: 'cal-1',
        category: 'spam',
        description: 'Test report',
        reporter_email_hash: null,
        reporter_account_id: null,
        reporter_type: 'anonymous',
        status: 'submitted',
        created_at: new Date('2026-02-10T10:00:00Z'),
      });

      const findByPkStub = sandbox.stub(ReportEntity, 'findByPk');
      findByPkStub.resolves(sourceReport);

      const result = await service.detectSourceFlooding('test-id');

      expect(result).toBeNull();
    });
  });

  describe('detectEventTargeting', () => {
    it('should detect multiple reports targeting same event', async () => {
      const eventId = 'event-123';

      const countStub = sandbox.stub(ReportEntity, 'count');
      countStub.resolves(5);

      const result = await service.detectEventTargeting(eventId);

      expect(result.type).toBe('event_targeting');
      expect(result.count).toBe(5);
      expect(result.threshold).toBe(3);
      expect(result.severity).toBe('high');
      expect(countStub.calledOnce).toBe(true);
    });

    it('should use custom time window', async () => {
      const eventId = 'event-123';

      const countStub = sandbox.stub(ReportEntity, 'count');
      countStub.resolves(4);

      const result = await service.detectEventTargeting(eventId, { timeWindowDays: 14 });

      expect(result.count).toBe(4);
      expect(countStub.calledOnce).toBe(true);

      // Verify the time window is correctly applied
      const callArgs = countStub.firstCall.args[0];
      expect(callArgs.where.created_at).toBeDefined();
    });

    it('should return low severity when count is below threshold', async () => {
      const eventId = 'event-123';

      const countStub = sandbox.stub(ReportEntity, 'count');
      countStub.resolves(2);

      const result = await service.detectEventTargeting(eventId);

      expect(result.type).toBe('event_targeting');
      expect(result.count).toBe(2);
      expect(result.severity).toBe('low');
    });
  });

  describe('detectInstancePatterns', () => {
    it('should detect elevated report volume from federated instance', async () => {
      const instanceUrl = 'evil.example.com';

      const countStub = sandbox.stub(ReportEntity, 'count');
      countStub.resolves(10);

      const result = await service.detectInstancePatterns(instanceUrl);

      expect(result.type).toBe('instance_pattern');
      expect(result.count).toBe(10);
      expect(result.threshold).toBe(5);
      expect(result.severity).toBe('high');
      expect(countStub.calledOnce).toBe(true);
    });

    it('should use custom threshold', async () => {
      const instanceUrl = 'suspicious.example.com';

      const countStub = sandbox.stub(ReportEntity, 'count');
      countStub.resolves(8);

      const result = await service.detectInstancePatterns(instanceUrl, { threshold: 10 });

      expect(result.count).toBe(8);
      expect(result.severity).toBe('low');
    });

    it('should return low severity when count is below threshold', async () => {
      const instanceUrl = 'friendly.example.com';

      const countStub = sandbox.stub(ReportEntity, 'count');
      countStub.resolves(3);

      const result = await service.detectInstancePatterns(instanceUrl);

      expect(result.type).toBe('instance_pattern');
      expect(result.count).toBe(3);
      expect(result.severity).toBe('low');
    });

    it('should handle time window parameter', async () => {
      const instanceUrl = 'test.example.com';

      const countStub = sandbox.stub(ReportEntity, 'count');
      countStub.resolves(6);

      const result = await service.detectInstancePatterns(instanceUrl, { timeWindowDays: 3 });

      expect(result.count).toBe(6);

      // Verify time window is applied
      const callArgs = countStub.firstCall.args[0];
      expect(callArgs.where.created_at).toBeDefined();
    });
  });

  describe('pattern detection with time windows', () => {
    it('should apply default 7-day time window for source flooding', async () => {
      const reporterId = 'test-reporter-id';
      const reporterEmailHash = 'hash-abc123';

      const sourceReport = ReportEntity.build({
        id: reporterId,
        event_id: 'event-1',
        calendar_id: 'cal-1',
        category: 'spam',
        description: 'Test report',
        reporter_email_hash: reporterEmailHash,
        reporter_account_id: null,
        reporter_type: 'anonymous',
        status: 'submitted',
        created_at: new Date('2026-02-10T10:00:00Z'),
      });

      const findByPkStub = sandbox.stub(ReportEntity, 'findByPk');
      findByPkStub.resolves(sourceReport);

      const countStub = sandbox.stub(ReportEntity, 'count');
      countStub.resolves(3);

      await service.detectSourceFlooding(reporterId);

      // Verify time window is applied (7 days = 604800000 ms)
      const callArgs = countStub.firstCall.args[0];
      expect(callArgs.where.created_at).toBeDefined();
      const timeCondition = callArgs.where.created_at[Op.gte];
      expect(timeCondition).toBeInstanceOf(Date);
    });
  });
});
