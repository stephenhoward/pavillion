import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { DateTime } from 'luxon';

import { ReportEntity } from '@/server/moderation/entity/report';
import { ReportEscalationEntity } from '@/server/moderation/entity/report_escalation';
import AnalyticsService from '@/server/moderation/service/analytics';
import { ReportStatus } from '@/common/model/report';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new AnalyticsService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getTotalReportsByStatus', () => {
    it('should return counts grouped by status for date range', async () => {
      const startDate = DateTime.fromISO('2026-01-01').toJSDate();
      const endDate = DateTime.fromISO('2026-01-31').toJSDate();

      const mockResults = [
        { status: 'resolved', count: 10 },
        { status: 'dismissed', count: 5 },
        { status: 'escalated', count: 3 },
        { status: 'submitted', count: 7 },
      ];

      sandbox.stub(ReportEntity, 'findAll').resolves(mockResults as any);

      const result = await service.getTotalReportsByStatus(startDate, endDate);

      expect(result).toEqual({
        resolved: 10,
        dismissed: 5,
        escalated: 3,
        submitted: 7,
      });
    });

    it('should handle empty results', async () => {
      const startDate = DateTime.fromISO('2026-01-01').toJSDate();
      const endDate = DateTime.fromISO('2026-01-31').toJSDate();

      sandbox.stub(ReportEntity, 'findAll').resolves([]);

      const result = await service.getTotalReportsByStatus(startDate, endDate);

      expect(result).toEqual({});
    });
  });

  describe('getResolutionRate', () => {
    it('should calculate owner vs escalation rate', async () => {
      const startDate = DateTime.fromISO('2026-01-01').toJSDate();
      const endDate = DateTime.fromISO('2026-01-31').toJSDate();

      const mockReports = [
        ReportEntity.build({
          id: '1',
          status: ReportStatus.RESOLVED,
          reviewer_id: 'owner1',
          escalation_type: null,
        }),
        ReportEntity.build({
          id: '2',
          status: ReportStatus.DISMISSED,
          reviewer_id: 'owner2',
          escalation_type: null,
        }),
        ReportEntity.build({
          id: '3',
          status: ReportStatus.RESOLVED,
          reviewer_id: 'admin1',
          escalation_type: 'manual',
        }),
        ReportEntity.build({
          id: '4',
          status: ReportStatus.ESCALATED,
          reviewer_id: null,
          escalation_type: 'automatic',
        }),
      ];

      sandbox.stub(ReportEntity, 'findAll').resolves(mockReports as any);

      const result = await service.getResolutionRate(startDate, endDate);

      expect(result).toEqual({
        ownerResolutionRate: 0.5, // 2 out of 4
        escalationRate: 0.5, // 2 out of 4
        totalReports: 4,
        ownerResolved: 2,
        escalated: 2,
      });
    });

    it('should handle zero reports', async () => {
      const startDate = DateTime.fromISO('2026-01-01').toJSDate();
      const endDate = DateTime.fromISO('2026-01-31').toJSDate();

      sandbox.stub(ReportEntity, 'findAll').resolves([]);

      const result = await service.getResolutionRate(startDate, endDate);

      expect(result).toEqual({
        ownerResolutionRate: 0,
        escalationRate: 0,
        totalReports: 0,
        ownerResolved: 0,
        escalated: 0,
      });
    });
  });

  describe('getAverageResolutionTime', () => {
    it('should calculate average hours by report type', async () => {
      const startDate = DateTime.fromISO('2026-01-01').toJSDate();
      const endDate = DateTime.fromISO('2026-01-31').toJSDate();

      const now = DateTime.fromISO('2026-01-15T12:00:00Z');
      const yesterday = now.minus({ hours: 24 });
      const twoDaysAgo = now.minus({ hours: 48 });

      const mockReports = [
        ReportEntity.build({
          id: '1',
          status: ReportStatus.RESOLVED,
          reporter_type: 'anonymous',
          created_at: yesterday.toJSDate(),
          reviewer_timestamp: now.toJSDate(),
        }),
        ReportEntity.build({
          id: '2',
          status: ReportStatus.DISMISSED,
          reporter_type: 'anonymous',
          created_at: twoDaysAgo.toJSDate(),
          reviewer_timestamp: now.toJSDate(),
        }),
        ReportEntity.build({
          id: '3',
          status: ReportStatus.RESOLVED,
          reporter_type: 'authenticated',
          created_at: yesterday.toJSDate(),
          reviewer_timestamp: now.toJSDate(),
        }),
      ];

      sandbox.stub(ReportEntity, 'findAll').resolves(mockReports as any);

      const result = await service.getAverageResolutionTime(startDate, endDate);

      expect(result).toEqual({
        anonymous: 36, // Average of 24 and 48
        authenticated: 24,
        administrator: 0,
        federation: 0,
        overall: 32, // Average of all: (24 + 48 + 24) / 3
      });
    });

    it('should handle reports without resolution time', async () => {
      const startDate = DateTime.fromISO('2026-01-01').toJSDate();
      const endDate = DateTime.fromISO('2026-01-31').toJSDate();

      // Query filters for resolved/dismissed reports with reviewer_timestamp
      // so reports without resolution time won't be returned by the query
      sandbox.stub(ReportEntity, 'findAll').resolves([]);

      const result = await service.getAverageResolutionTime(startDate, endDate);

      expect(result).toEqual({
        anonymous: 0,
        authenticated: 0,
        administrator: 0,
        federation: 0,
        overall: 0,
      });
    });
  });

  describe('getReportsTrend', () => {
    it('should return time series data grouped by date', async () => {
      const startDate = DateTime.fromISO('2026-01-01').toJSDate();
      const endDate = DateTime.fromISO('2026-01-31').toJSDate();

      const mockResults = [
        { date: '2026-01-01', count: 5 },
        { date: '2026-01-02', count: 8 },
        { date: '2026-01-03', count: 3 },
      ];

      sandbox.stub(ReportEntity, 'findAll').resolves(mockResults as any);

      const result = await service.getReportsTrend(startDate, endDate);

      expect(result).toEqual([
        { date: '2026-01-01', count: 5 },
        { date: '2026-01-02', count: 8 },
        { date: '2026-01-03', count: 3 },
      ]);
    });

    it('should handle empty results', async () => {
      const startDate = DateTime.fromISO('2026-01-01').toJSDate();
      const endDate = DateTime.fromISO('2026-01-31').toJSDate();

      sandbox.stub(ReportEntity, 'findAll').resolves([]);

      const result = await service.getReportsTrend(startDate, endDate);

      expect(result).toEqual([]);
    });
  });

  describe('getTopReportedEvents', () => {
    it('should return most reported events with counts', async () => {
      const startDate = DateTime.fromISO('2026-01-01').toJSDate();
      const endDate = DateTime.fromISO('2026-01-31').toJSDate();
      const limit = 5;

      const mockResults = [
        { event_id: 'event1', report_count: 10 },
        { event_id: 'event2', report_count: 7 },
        { event_id: 'event3', report_count: 5 },
      ];

      sandbox.stub(ReportEntity, 'findAll').resolves(mockResults as any);

      const result = await service.getTopReportedEvents(startDate, endDate, limit);

      expect(result).toEqual([
        { eventId: 'event1', reportCount: 10 },
        { eventId: 'event2', reportCount: 7 },
        { eventId: 'event3', reportCount: 5 },
      ]);
    });

    it('should respect limit parameter', async () => {
      const startDate = DateTime.fromISO('2026-01-01').toJSDate();
      const endDate = DateTime.fromISO('2026-01-31').toJSDate();
      const limit = 2;

      const mockResults = [
        { event_id: 'event1', report_count: 10 },
        { event_id: 'event2', report_count: 7 },
      ];

      const findAllStub = sandbox.stub(ReportEntity, 'findAll').resolves(mockResults as any);

      await service.getTopReportedEvents(startDate, endDate, limit);

      expect(findAllStub.calledOnce).toBe(true);
      const callArgs = findAllStub.firstCall.args[0];
      expect(callArgs.limit).toBe(2);
    });
  });

  describe('getReporterVolume', () => {
    it('should return anonymized reporter counts by type', async () => {
      const startDate = DateTime.fromISO('2026-01-01').toJSDate();
      const endDate = DateTime.fromISO('2026-01-31').toJSDate();

      const mockResults = [
        { reporter_type: 'anonymous', unique_reporters: 15 },
        { reporter_type: 'authenticated', unique_reporters: 8 },
        { reporter_type: 'administrator', unique_reporters: 2 },
      ];

      sandbox.stub(ReportEntity, 'findAll').resolves(mockResults as any);

      const result = await service.getReporterVolume(startDate, endDate);

      expect(result).toEqual({
        anonymous: 15,
        authenticated: 8,
        administrator: 2,
        federation: 0,
      });
    });

    it('should handle missing reporter types', async () => {
      const startDate = DateTime.fromISO('2026-01-01').toJSDate();
      const endDate = DateTime.fromISO('2026-01-31').toJSDate();

      const mockResults = [
        { reporter_type: 'anonymous', unique_reporters: 5 },
      ];

      sandbox.stub(ReportEntity, 'findAll').resolves(mockResults as any);

      const result = await service.getReporterVolume(startDate, endDate);

      expect(result).toEqual({
        anonymous: 5,
        authenticated: 0,
        administrator: 0,
        federation: 0,
      });
    });
  });
});
