import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

import { ReportCategory, ReportStatus } from '@/common/model/report';
import { ReportEntity } from '@/server/moderation/entity/report';
import { ReportEscalationEntity } from '@/server/moderation/entity/report_escalation';
import ModerationService from '@/server/moderation/service/moderation';
import ConfigurationInterface from '@/server/configuration/interface';
import ServiceSettingEntity from '@/server/configuration/entity/settings';
import { TestEnvironment } from '@/server/test/lib/test_environment';
import { v4 as uuidv4 } from 'uuid';

describe('ModerationService - Auto-Escalation Integration', () => {
  let service: ModerationService;
  let eventBus: EventEmitter;
  let configInterface: ConfigurationInterface;
  let eventId: string;
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  beforeEach(() => {
    eventBus = new EventEmitter();
    configInterface = new ConfigurationInterface();
    service = new ModerationService(eventBus, undefined, configInterface);
    eventId = uuidv4();
  });

  afterEach(async () => {
    // Clean up test data
    await ReportEntity.destroy({ where: {} });
    await ReportEscalationEntity.destroy({ where: {} });
    await ServiceSettingEntity.destroy({ where: { parameter: 'moderation.autoEscalationThreshold' } });
  });

  describe('checkAutoEscalation', () => {

    it('should not escalate when threshold is 0', async () => {
      // Set threshold to 0 (disabled)
      await ServiceSettingEntity.create({
        parameter: 'moderation.autoEscalationThreshold',
        value: '0',
      });

      // Create 5 reports
      for (let i = 0; i < 5; i++) {
        await ReportEntity.create({
          id: uuidv4(),
          event_id: eventId,
          calendar_id: uuidv4(),
          category: ReportCategory.SPAM,
          description: `Test report ${i}`,
          reporter_type: 'anonymous',
          reporter_email_hash: `hash${i}`,
          status: ReportStatus.SUBMITTED,
        });
      }

      const escalatedCount = await service.checkAutoEscalation(eventId);

      expect(escalatedCount).toBe(0);

      // Verify no reports were escalated
      const escalated = await ReportEntity.findAll({
        where: { event_id: eventId, status: ReportStatus.ESCALATED },
      });
      expect(escalated).toHaveLength(0);
    });

    it('should not escalate when below threshold', async () => {
      // Set threshold to 5
      await ServiceSettingEntity.create({
        parameter: 'moderation.autoEscalationThreshold',
        value: '5',
      });

      // Create only 3 reports (below threshold)
      for (let i = 0; i < 3; i++) {
        await ReportEntity.create({
          id: uuidv4(),
          event_id: eventId,
          calendar_id: uuidv4(),
          category: ReportCategory.SPAM,
          description: `Test report ${i}`,
          reporter_type: 'anonymous',
          reporter_email_hash: `hash${i}`,
          status: ReportStatus.SUBMITTED,
        });
      }

      const escalatedCount = await service.checkAutoEscalation(eventId);

      expect(escalatedCount).toBe(0);

      // Verify no reports were escalated
      const escalated = await ReportEntity.findAll({
        where: { event_id: eventId, status: ReportStatus.ESCALATED },
      });
      expect(escalated).toHaveLength(0);
    });

    it('should escalate all pending reports when threshold is reached', async () => {
      // Set threshold to 3
      await ServiceSettingEntity.create({
        parameter: 'moderation.autoEscalationThreshold',
        value: '3',
      });

      // Create 3 reports (meets threshold)
      const reportIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const id = uuidv4();
        reportIds.push(id);
        await ReportEntity.create({
          id,
          event_id: eventId,
          calendar_id: uuidv4(),
          category: ReportCategory.SPAM,
          description: `Test report ${i}`,
          reporter_type: 'anonymous',
          reporter_email_hash: `hash${i}`,
          status: ReportStatus.SUBMITTED,
        });
      }

      const escalatedCount = await service.checkAutoEscalation(eventId);

      expect(escalatedCount).toBe(3);

      // Verify all reports were escalated
      const escalated = await ReportEntity.findAll({
        where: { event_id: eventId, status: ReportStatus.ESCALATED },
      });
      expect(escalated).toHaveLength(3);

      // Verify escalation type is 'automatic'
      for (const report of escalated) {
        expect(report.escalation_type).toBe('automatic');
      }

      // Verify escalation records were created
      const escalationRecords = await ReportEscalationEntity.findAll({
        where: { report_id: reportIds },
      });
      expect(escalationRecords).toHaveLength(3);

      // Verify escalation record metadata
      for (const record of escalationRecords) {
        expect(record.from_status).toBe(ReportStatus.SUBMITTED);
        expect(record.to_status).toBe(ReportStatus.ESCALATED);
        expect(record.reviewer_role).toBe('system');
        expect(record.decision).toBe('auto-escalated');
        expect(record.notes).toContain('threshold');
      }
    });

    it('should only escalate pending and owner_review reports', async () => {
      // Set threshold to 3
      await ServiceSettingEntity.create({
        parameter: 'moderation.autoEscalationThreshold',
        value: '3',
      });

      // Create reports with different statuses
      const pendingId = uuidv4();
      await ReportEntity.create({
        id: pendingId,
        event_id: eventId,
        calendar_id: uuidv4(),
        category: ReportCategory.SPAM,
        description: 'Pending report',
        reporter_type: 'anonymous',
        reporter_email_hash: 'hash1',
        status: ReportStatus.SUBMITTED,
      });

      const reviewId = uuidv4();
      await ReportEntity.create({
        id: reviewId,
        event_id: eventId,
        calendar_id: uuidv4(),
        category: ReportCategory.SPAM,
        description: 'Under review report',
        reporter_type: 'anonymous',
        reporter_email_hash: 'hash2',
        status: ReportStatus.UNDER_REVIEW,
      });

      const escalatedId = uuidv4();
      await ReportEntity.create({
        id: escalatedId,
        event_id: eventId,
        calendar_id: uuidv4(),
        category: ReportCategory.SPAM,
        description: 'Already escalated',
        reporter_type: 'anonymous',
        reporter_email_hash: 'hash3',
        status: ReportStatus.ESCALATED,
      });

      const resolvedId = uuidv4();
      await ReportEntity.create({
        id: resolvedId,
        event_id: eventId,
        calendar_id: uuidv4(),
        category: ReportCategory.SPAM,
        description: 'Resolved report',
        reporter_type: 'anonymous',
        reporter_email_hash: 'hash4',
        status: ReportStatus.RESOLVED,
      });

      const escalatedCount = await service.checkAutoEscalation(eventId);

      // Should escalate pending and owner_review only
      expect(escalatedCount).toBe(2);

      // Verify correct reports were escalated
      const pendingReport = await ReportEntity.findByPk(pendingId);
      expect(pendingReport?.status).toBe(ReportStatus.ESCALATED);

      const reviewReport = await ReportEntity.findByPk(reviewId);
      expect(reviewReport?.status).toBe(ReportStatus.ESCALATED);

      // Verify other statuses were not changed
      const escalatedReport = await ReportEntity.findByPk(escalatedId);
      expect(escalatedReport?.status).toBe(ReportStatus.ESCALATED);

      const resolvedReport = await ReportEntity.findByPk(resolvedId);
      expect(resolvedReport?.status).toBe(ReportStatus.RESOLVED);
    });

    it('should use default threshold of 5 when not configured', async () => {
      // Don't set any threshold configuration

      // Create 5 reports (meets default threshold)
      for (let i = 0; i < 5; i++) {
        await ReportEntity.create({
          id: uuidv4(),
          event_id: eventId,
          calendar_id: uuidv4(),
          category: ReportCategory.SPAM,
          description: `Test report ${i}`,
          reporter_type: 'anonymous',
          reporter_email_hash: `hash${i}`,
          status: ReportStatus.SUBMITTED,
        });
      }

      const escalatedCount = await service.checkAutoEscalation(eventId);

      expect(escalatedCount).toBe(5);

      // Verify all reports were escalated
      const escalated = await ReportEntity.findAll({
        where: { event_id: eventId, status: ReportStatus.ESCALATED },
      });
      expect(escalated).toHaveLength(5);
    });

    it('should emit reportEscalated events', async () => {
      // Set threshold to 2
      await ServiceSettingEntity.create({
        parameter: 'moderation.autoEscalationThreshold',
        value: '2',
      });

      // Create 2 reports
      for (let i = 0; i < 2; i++) {
        await ReportEntity.create({
          id: uuidv4(),
          event_id: eventId,
          calendar_id: uuidv4(),
          category: ReportCategory.SPAM,
          description: `Test report ${i}`,
          reporter_type: 'anonymous',
          reporter_email_hash: `hash${i}`,
          status: ReportStatus.SUBMITTED,
        });
      }

      // Track emitted events
      const emittedEvents: any[] = [];
      eventBus.on('reportEscalated', (payload) => {
        emittedEvents.push(payload);
      });

      const escalatedCount = await service.checkAutoEscalation(eventId);

      expect(escalatedCount).toBe(2);
      expect(emittedEvents).toHaveLength(2);

      // Verify event payloads
      for (const event of emittedEvents) {
        expect(event.report).toBeDefined();
        expect(event.report.status).toBe(ReportStatus.ESCALATED);
        expect(event.reason).toContain('threshold');
      }
    });

    it('should handle multiple events independently', async () => {
      // Set threshold to 2
      await ServiceSettingEntity.create({
        parameter: 'moderation.autoEscalationThreshold',
        value: '2',
      });

      const event1Id = uuidv4();
      const event2Id = uuidv4();

      // Create 2 reports for event1 (meets threshold)
      for (let i = 0; i < 2; i++) {
        await ReportEntity.create({
          id: uuidv4(),
          event_id: event1Id,
          calendar_id: uuidv4(),
          category: ReportCategory.SPAM,
          description: `Event1 report ${i}`,
          reporter_type: 'anonymous',
          reporter_email_hash: `hash1_${i}`,
          status: ReportStatus.SUBMITTED,
        });
      }

      // Create 1 report for event2 (below threshold)
      await ReportEntity.create({
        id: uuidv4(),
        event_id: event2Id,
        calendar_id: uuidv4(),
        category: ReportCategory.SPAM,
        description: 'Event2 report',
        reporter_type: 'anonymous',
        reporter_email_hash: 'hash2_0',
        status: ReportStatus.SUBMITTED,
      });

      // Check event1
      const escalated1 = await service.checkAutoEscalation(event1Id);
      expect(escalated1).toBe(2);

      // Check event2
      const escalated2 = await service.checkAutoEscalation(event2Id);
      expect(escalated2).toBe(0);

      // Verify database state
      const event1Reports = await ReportEntity.findAll({
        where: { event_id: event1Id },
      });
      expect(event1Reports.every(r => r.status === ReportStatus.ESCALATED)).toBe(true);

      const event2Reports = await ReportEntity.findAll({
        where: { event_id: event2Id },
      });
      expect(event2Reports.every(r => r.status === ReportStatus.SUBMITTED)).toBe(true);
    });
  });
});
