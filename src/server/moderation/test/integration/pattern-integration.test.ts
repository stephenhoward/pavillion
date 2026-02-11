import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

import { ReportCategory, ReportStatus } from '@/common/model/report';
import { ReportEntity } from '@/server/moderation/entity/report';
import { EventReporterEntity } from '@/server/moderation/entity/event_reporter';
import { PatternDetectionService } from '@/server/moderation/service/pattern-detection';
import { TestEnvironment } from '@/server/test/lib/test_environment';
import { v4 as uuidv4 } from 'uuid';

describe('Pattern Detection Integration - Database Persistence', () => {
  let patternService: PatternDetectionService;
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  beforeEach(() => {
    patternService = new PatternDetectionService();
  });

  afterEach(async () => {
    // Clean up test data
    await EventReporterEntity.destroy({ where: {} });
    await ReportEntity.destroy({ where: {} });
  });

  describe('Pattern detection with database queries', () => {
    it('should detect source flooding pattern from database', async () => {
      const reporterEmailHash = 'test-email-hash-123';
      const calendarId = uuidv4();

      // Create 3 reports from same reporter targeting different events
      const reportIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const reportId = uuidv4();
        reportIds.push(reportId);

        await ReportEntity.create({
          id: reportId,
          event_id: uuidv4(),
          calendar_id: calendarId,
          category: ReportCategory.SPAM,
          description: `Spam report ${i + 1}`,
          reporter_type: 'anonymous',
          reporter_email_hash: reporterEmailHash,
          status: ReportStatus.SUBMITTED,
          created_at: new Date(),
        });
      }

      // Test pattern detection on the last report
      const result = await patternService.detectSourceFlooding(reportIds[2]);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('source_flooding');
      expect(result!.count).toBe(3);
      expect(result!.severity).toBe('high');
    });

    it('should detect event targeting pattern from database', async () => {
      const eventId = uuidv4();
      const calendarId = uuidv4();

      // Create 3 reports from different reporters targeting same event
      for (let i = 0; i < 3; i++) {
        await ReportEntity.create({
          id: uuidv4(),
          event_id: eventId,
          calendar_id: calendarId,
          category: ReportCategory.HARASSMENT,
          description: `Harassment report ${i + 1}`,
          reporter_type: 'anonymous',
          reporter_email_hash: `email-hash-${i}`,
          status: ReportStatus.SUBMITTED,
          created_at: new Date(),
        });
      }

      // Test pattern detection for the event
      const result = await patternService.detectEventTargeting(eventId);

      expect(result).not.toBeNull();
      expect(result.type).toBe('event_targeting');
      expect(result.count).toBe(3);
      expect(result.severity).toBe('high');
    });

    it('should detect instance pattern from database', async () => {
      const calendarId = uuidv4();
      const instanceUrl = 'suspicious.example.com';

      // Create 5 federated reports from same instance
      for (let i = 0; i < 5; i++) {
        await ReportEntity.create({
          id: uuidv4(),
          event_id: uuidv4(),
          calendar_id: calendarId,
          category: ReportCategory.SPAM,
          description: `Federation report ${i + 1}`,
          reporter_type: 'federation',
          forwarded_from_instance: instanceUrl,
          forwarded_report_id: `remote-${i + 1}`,
          status: ReportStatus.SUBMITTED,
          created_at: new Date(),
        });
      }

      // Test pattern detection for the instance
      const result = await patternService.detectInstancePatterns(instanceUrl);

      expect(result).not.toBeNull();
      expect(result.type).toBe('instance_pattern');
      expect(result.count).toBe(5);
      expect(result.severity).toBe('high');
    });

    it('should persist pattern flags when updated via entity', async () => {
      const reportId = uuidv4();
      const eventId = uuidv4();
      const calendarId = uuidv4();

      // Create a report
      await ReportEntity.create({
        id: reportId,
        event_id: eventId,
        calendar_id: calendarId,
        category: ReportCategory.SPAM,
        description: 'Test report',
        reporter_type: 'anonymous',
        reporter_email_hash: 'test-hash',
        status: ReportStatus.SUBMITTED,
        has_source_flooding_pattern: false,
        has_event_targeting_pattern: false,
        has_instance_pattern: false,
        created_at: new Date(),
      });

      // Update pattern flags as would happen in the service
      await ReportEntity.update(
        {
          has_source_flooding_pattern: true,
          has_event_targeting_pattern: true,
        },
        { where: { id: reportId } },
      );

      // Verify flags are persisted
      const savedReport = await ReportEntity.findByPk(reportId);
      expect(savedReport).toBeDefined();
      expect(savedReport!.has_source_flooding_pattern).toBe(true);
      expect(savedReport!.has_event_targeting_pattern).toBe(true);
      expect(savedReport!.has_instance_pattern).toBe(false);
    });

    it('should handle time-based pattern detection correctly', async () => {
      const eventId = uuidv4();
      const calendarId = uuidv4();

      // Create old report (outside time window)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10); // 10 days ago

      await ReportEntity.create({
        id: uuidv4(),
        event_id: eventId,
        calendar_id: calendarId,
        category: ReportCategory.SPAM,
        description: 'Old report',
        reporter_type: 'anonymous',
        reporter_email_hash: 'hash-1',
        status: ReportStatus.SUBMITTED,
        created_at: oldDate,
      });

      // Create recent reports (within time window)
      for (let i = 0; i < 2; i++) {
        await ReportEntity.create({
          id: uuidv4(),
          event_id: eventId,
          calendar_id: calendarId,
          category: ReportCategory.SPAM,
          description: `Recent report ${i + 1}`,
          reporter_type: 'anonymous',
          reporter_email_hash: `hash-${i + 2}`,
          status: ReportStatus.SUBMITTED,
          created_at: new Date(),
        });
      }

      // Pattern detection should only count reports within 7-day window
      const result = await patternService.detectEventTargeting(eventId);

      expect(result).not.toBeNull();
      expect(result.count).toBe(2); // Only recent reports
      expect(result.severity).toBe('low'); // Below threshold
    });
  });
});
