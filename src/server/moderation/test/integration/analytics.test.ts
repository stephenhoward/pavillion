import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { DateTime } from 'luxon';

import { ReportEntity } from '@/server/moderation/entity/report';
import AnalyticsService from '@/server/moderation/service/analytics';
import { ReportStatus, ReportCategory } from '@/common/model/report';
import { TestEnvironment } from '@/server/test/lib/test_environment';

describe('AnalyticsService Integration', () => {
  let service: AnalyticsService;
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  beforeEach(() => {
    service = new AnalyticsService();
  });

  afterEach(async () => {
    // Clean up test data
    await ReportEntity.destroy({ where: {} });
  });

  describe('getTotalReportsByStatus', () => {
    it('should aggregate reports by status with real database', async () => {
      const startDate = DateTime.fromISO('2026-01-01').toJSDate();
      const endDate = DateTime.fromISO('2026-01-31').toJSDate();

      // Create test reports
      await ReportEntity.create({
        id: '11111111-1111-1111-1111-111111111111',
        event_id: 'event1',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Test report 1',
        reporter_type: 'anonymous',
        status: ReportStatus.RESOLVED,
        created_at: DateTime.fromISO('2026-01-15').toJSDate(),
      });

      await ReportEntity.create({
        id: '22222222-2222-2222-2222-222222222222',
        event_id: 'event2',
        calendar_id: 'cal1',
        category: ReportCategory.INAPPROPRIATE,
        description: 'Test report 2',
        reporter_type: 'anonymous',
        status: ReportStatus.RESOLVED,
        created_at: DateTime.fromISO('2026-01-16').toJSDate(),
      });

      await ReportEntity.create({
        id: '33333333-3333-3333-3333-333333333333',
        event_id: 'event3',
        calendar_id: 'cal1',
        category: ReportCategory.MISLEADING,
        description: 'Test report 3',
        reporter_type: 'anonymous',
        status: ReportStatus.DISMISSED,
        created_at: DateTime.fromISO('2026-01-17').toJSDate(),
      });

      await ReportEntity.create({
        id: '44444444-4444-4444-4444-444444444444',
        event_id: 'event4',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Test report 4',
        reporter_type: 'anonymous',
        status: ReportStatus.ESCALATED,
        created_at: DateTime.fromISO('2026-01-18').toJSDate(),
      });

      const result = await service.getTotalReportsByStatus(startDate, endDate);

      expect(result).toEqual({
        resolved: 2,
        dismissed: 1,
        escalated: 1,
      });
    });
  });

  describe('getResolutionRate', () => {
    it('should calculate resolution rates with real database', async () => {
      const startDate = DateTime.fromISO('2026-01-01').toJSDate();
      const endDate = DateTime.fromISO('2026-01-31').toJSDate();

      // Owner-resolved reports (no escalation_type)
      await ReportEntity.create({
        id: '11111111-1111-1111-1111-111111111111',
        event_id: 'event1',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Owner resolved 1',
        reporter_type: 'anonymous',
        status: ReportStatus.RESOLVED,
        escalation_type: null,
        created_at: DateTime.fromISO('2026-01-15').toJSDate(),
      });

      await ReportEntity.create({
        id: '22222222-2222-2222-2222-222222222222',
        event_id: 'event2',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Owner resolved 2',
        reporter_type: 'anonymous',
        status: ReportStatus.DISMISSED,
        escalation_type: null,
        created_at: DateTime.fromISO('2026-01-16').toJSDate(),
      });

      // Escalated reports
      await ReportEntity.create({
        id: '33333333-3333-3333-3333-333333333333',
        event_id: 'event3',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Escalated 1',
        reporter_type: 'anonymous',
        status: ReportStatus.ESCALATED,
        escalation_type: 'automatic',
        created_at: DateTime.fromISO('2026-01-17').toJSDate(),
      });

      await ReportEntity.create({
        id: '44444444-4444-4444-4444-444444444444',
        event_id: 'event4',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Escalated 2',
        reporter_type: 'anonymous',
        status: ReportStatus.RESOLVED,
        escalation_type: 'manual',
        created_at: DateTime.fromISO('2026-01-18').toJSDate(),
      });

      const result = await service.getResolutionRate(startDate, endDate);

      expect(result).toEqual({
        ownerResolutionRate: 0.5,
        escalationRate: 0.5,
        totalReports: 4,
        ownerResolved: 2,
        escalated: 2,
      });
    });
  });

  describe('getAverageResolutionTime', () => {
    it('should calculate average resolution time with real database', async () => {
      const startDate = DateTime.fromISO('2026-01-01').toJSDate();
      const endDate = DateTime.fromISO('2026-01-31').toJSDate();

      const now = DateTime.fromISO('2026-01-15T12:00:00Z');

      // Anonymous report resolved in 24 hours
      await ReportEntity.create({
        id: '11111111-1111-1111-1111-111111111111',
        event_id: 'event1',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Report 1',
        reporter_type: 'anonymous',
        status: ReportStatus.RESOLVED,
        created_at: now.minus({ hours: 24 }).toJSDate(),
        reviewer_timestamp: now.toJSDate(),
      });

      // Anonymous report resolved in 48 hours
      await ReportEntity.create({
        id: '22222222-2222-2222-2222-222222222222',
        event_id: 'event2',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Report 2',
        reporter_type: 'anonymous',
        status: ReportStatus.DISMISSED,
        created_at: now.minus({ hours: 48 }).toJSDate(),
        reviewer_timestamp: now.toJSDate(),
      });

      // Authenticated report resolved in 12 hours
      await ReportEntity.create({
        id: '33333333-3333-3333-3333-333333333333',
        event_id: 'event3',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Report 3',
        reporter_type: 'authenticated',
        status: ReportStatus.RESOLVED,
        created_at: now.minus({ hours: 12 }).toJSDate(),
        reviewer_timestamp: now.toJSDate(),
      });

      const result = await service.getAverageResolutionTime(startDate, endDate);

      expect(result).toEqual({
        anonymous: 36, // Average of 24 and 48
        authenticated: 12,
        administrator: 0,
        federation: 0,
        overall: 28, // Average of all: (24 + 48 + 12) / 3
      });
    });
  });

  describe('getReportsTrend', () => {
    it('should return time series data with real database', async () => {
      const startDate = DateTime.fromISO('2026-01-01').toJSDate();
      const endDate = DateTime.fromISO('2026-01-31').toJSDate();

      // Create reports on different dates
      await ReportEntity.create({
        id: '11111111-1111-1111-1111-111111111111',
        event_id: 'event1',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Report 1',
        reporter_type: 'anonymous',
        status: ReportStatus.SUBMITTED,
        created_at: DateTime.fromISO('2026-01-15T10:00:00').toJSDate(),
      });

      await ReportEntity.create({
        id: '22222222-2222-2222-2222-222222222222',
        event_id: 'event2',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Report 2',
        reporter_type: 'anonymous',
        status: ReportStatus.SUBMITTED,
        created_at: DateTime.fromISO('2026-01-15T14:00:00').toJSDate(),
      });

      await ReportEntity.create({
        id: '33333333-3333-3333-3333-333333333333',
        event_id: 'event3',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Report 3',
        reporter_type: 'anonymous',
        status: ReportStatus.SUBMITTED,
        created_at: DateTime.fromISO('2026-01-16T10:00:00').toJSDate(),
      });

      const result = await service.getReportsTrend(startDate, endDate);

      expect(result.length).toBe(2);
      expect(result[0].date).toBe('2026-01-15');
      expect(result[0].count).toBe(2);
      expect(result[1].date).toBe('2026-01-16');
      expect(result[1].count).toBe(1);
    });
  });

  describe('getTopReportedEvents', () => {
    it('should return most reported events with real database', async () => {
      const startDate = DateTime.fromISO('2026-01-01').toJSDate();
      const endDate = DateTime.fromISO('2026-01-31').toJSDate();

      // Event1 gets 3 reports
      await ReportEntity.create({
        id: '11111111-1111-1111-1111-111111111111',
        event_id: 'event1',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Report 1',
        reporter_type: 'anonymous',
        status: ReportStatus.SUBMITTED,
        created_at: DateTime.fromISO('2026-01-15').toJSDate(),
      });

      await ReportEntity.create({
        id: '22222222-2222-2222-2222-222222222222',
        event_id: 'event1',
        calendar_id: 'cal1',
        category: ReportCategory.INAPPROPRIATE,
        description: 'Report 2',
        reporter_type: 'anonymous',
        status: ReportStatus.SUBMITTED,
        created_at: DateTime.fromISO('2026-01-16').toJSDate(),
      });

      await ReportEntity.create({
        id: '33333333-3333-3333-3333-333333333333',
        event_id: 'event1',
        calendar_id: 'cal1',
        category: ReportCategory.MISLEADING,
        description: 'Report 3',
        reporter_type: 'anonymous',
        status: ReportStatus.SUBMITTED,
        created_at: DateTime.fromISO('2026-01-17').toJSDate(),
      });

      // Event2 gets 2 reports
      await ReportEntity.create({
        id: '44444444-4444-4444-4444-444444444444',
        event_id: 'event2',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Report 4',
        reporter_type: 'anonymous',
        status: ReportStatus.SUBMITTED,
        created_at: DateTime.fromISO('2026-01-18').toJSDate(),
      });

      await ReportEntity.create({
        id: '55555555-5555-5555-5555-555555555555',
        event_id: 'event2',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Report 5',
        reporter_type: 'anonymous',
        status: ReportStatus.SUBMITTED,
        created_at: DateTime.fromISO('2026-01-19').toJSDate(),
      });

      // Event3 gets 1 report
      await ReportEntity.create({
        id: '66666666-6666-6666-6666-666666666666',
        event_id: 'event3',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Report 6',
        reporter_type: 'anonymous',
        status: ReportStatus.SUBMITTED,
        created_at: DateTime.fromISO('2026-01-20').toJSDate(),
      });

      const result = await service.getTopReportedEvents(startDate, endDate, 10);

      expect(result).toEqual([
        { eventId: 'event1', reportCount: 3 },
        { eventId: 'event2', reportCount: 2 },
        { eventId: 'event3', reportCount: 1 },
      ]);
    });

    it('should respect limit parameter with real database', async () => {
      const startDate = DateTime.fromISO('2026-01-01').toJSDate();
      const endDate = DateTime.fromISO('2026-01-31').toJSDate();

      // Create reports for 3 different events
      for (let i = 1; i <= 3; i++) {
        await ReportEntity.create({
          id: `${i}${i}${i}${i}${i}${i}${i}${i}-${i}${i}${i}${i}-${i}${i}${i}${i}-${i}${i}${i}${i}-${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}${i}`,
          event_id: `event${i}`,
          calendar_id: 'cal1',
          category: ReportCategory.SPAM,
          description: `Report ${i}`,
          reporter_type: 'anonymous',
          status: ReportStatus.SUBMITTED,
          created_at: DateTime.fromISO('2026-01-15').toJSDate(),
        });
      }

      const result = await service.getTopReportedEvents(startDate, endDate, 2);

      expect(result.length).toBe(2);
    });
  });

  describe('getReporterVolume', () => {
    it('should count unique reporters by type with real database', async () => {
      const startDate = DateTime.fromISO('2026-01-01').toJSDate();
      const endDate = DateTime.fromISO('2026-01-31').toJSDate();

      // Anonymous reporters (identified by email hash)
      await ReportEntity.create({
        id: '11111111-1111-1111-1111-111111111111',
        event_id: 'event1',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Report 1',
        reporter_type: 'anonymous',
        reporter_email_hash: 'hash1',
        status: ReportStatus.SUBMITTED,
        created_at: DateTime.fromISO('2026-01-15').toJSDate(),
      });

      await ReportEntity.create({
        id: '22222222-2222-2222-2222-222222222222',
        event_id: 'event2',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Report 2',
        reporter_type: 'anonymous',
        reporter_email_hash: 'hash1', // Same reporter
        status: ReportStatus.SUBMITTED,
        created_at: DateTime.fromISO('2026-01-16').toJSDate(),
      });

      await ReportEntity.create({
        id: '33333333-3333-3333-3333-333333333333',
        event_id: 'event3',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Report 3',
        reporter_type: 'anonymous',
        reporter_email_hash: 'hash2', // Different reporter
        status: ReportStatus.SUBMITTED,
        created_at: DateTime.fromISO('2026-01-17').toJSDate(),
      });

      // Authenticated reporters (identified by account_id)
      await ReportEntity.create({
        id: '44444444-4444-4444-4444-444444444444',
        event_id: 'event4',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Report 4',
        reporter_type: 'authenticated',
        reporter_account_id: 'account1',
        status: ReportStatus.SUBMITTED,
        created_at: DateTime.fromISO('2026-01-18').toJSDate(),
      });

      await ReportEntity.create({
        id: '55555555-5555-5555-5555-555555555555',
        event_id: 'event5',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Report 5',
        reporter_type: 'authenticated',
        reporter_account_id: 'account2',
        status: ReportStatus.SUBMITTED,
        created_at: DateTime.fromISO('2026-01-19').toJSDate(),
      });

      const result = await service.getReporterVolume(startDate, endDate);

      expect(result).toEqual({
        anonymous: 2, // hash1 and hash2
        authenticated: 2, // account1 and account2
        administrator: 0,
        federation: 0,
      });
    });
  });
});
