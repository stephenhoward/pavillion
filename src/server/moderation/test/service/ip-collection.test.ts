import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Report, ReportCategory, ReportStatus } from '@/common/model/report';
import { ReportEntity } from '@/server/moderation/entity/report';
import { EventReporterEntity } from '@/server/moderation/entity/event_reporter';
import ModerationService from '@/server/moderation/service/moderation';

/**
 * Tests for IP collection during report submission.
 * Verifies that IP address, hashed IP, subnet, and region are captured
 * and stored correctly when reports are created.
 */
describe('ModerationService - IP Collection', () => {
  let sandbox: sinon.SinonSandbox;
  let service: ModerationService;
  let eventBus: EventEmitter;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    service = new ModerationService(eventBus);

    // Stub pattern detection to avoid database calls
    sandbox.stub(service, 'detectAndSetPatternFlags' as any).resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('createReport with IP data', () => {

    it('should capture and store IP data when provided', async () => {
      sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);
      sandbox.stub(service, 'hasExceededEmailRateLimit').resolves(false);
      sandbox.stub(service, 'isEmailBlocked' as any).resolves(false);

      let capturedReport: Report | null = null;
      sandbox.stub(ReportEntity, 'fromModel').callsFake((r: Report) => {
        capturedReport = r;
        return {
          save: sandbox.stub().resolves({ toModel: () => r }),
        } as any;
      });
      sandbox.stub(EventReporterEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({}),
      } as any);

      await service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'Test report',
        reporterEmail: 'test@example.com',
        reporterType: 'anonymous',
        reporterIp: '192.168.1.100',
        reporterIpSubnet: '192.168.1.0',
        reporterIpRegion: 'US-CA',
      });

      expect(capturedReport).not.toBeNull();
      expect(capturedReport!.reporterIpHash).toBeTruthy();
      expect(capturedReport!.reporterIpHash!.length).toBe(64); // SHA-256 hex
      expect(capturedReport!.reporterIpSubnet).toBe('192.168.1.0');
      expect(capturedReport!.reporterIpRegion).toBe('US-CA');
    });

    it('should hash the IP address consistently', async () => {
      sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);

      const capturedReports: Report[] = [];
      sandbox.stub(ReportEntity, 'fromModel').callsFake((r: Report) => {
        capturedReports.push(r);
        return {
          save: sandbox.stub().resolves({ toModel: () => r }),
        } as any;
      });
      sandbox.stub(EventReporterEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({}),
      } as any);

      // Create two reports with the same IP
      await service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'First report',
        reporterAccountId: 'account-1',
        reporterType: 'authenticated',
        reporterIp: '192.168.1.100',
        reporterIpSubnet: '192.168.1.0',
        reporterIpRegion: 'US-CA',
      });

      await service.createReport({
        eventId: 'event-2',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'Second report',
        reporterAccountId: 'account-1',
        reporterType: 'authenticated',
        reporterIp: '192.168.1.100',
        reporterIpSubnet: '192.168.1.0',
        reporterIpRegion: 'US-CA',
      });

      // Same IP should produce same hash
      expect(capturedReports[0].reporterIpHash).toBe(capturedReports[1].reporterIpHash);
    });

    it('should produce different hashes for different IPs', async () => {
      sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);

      const capturedReports: Report[] = [];
      sandbox.stub(ReportEntity, 'fromModel').callsFake((r: Report) => {
        capturedReports.push(r);
        return {
          save: sandbox.stub().resolves({ toModel: () => r }),
        } as any;
      });
      sandbox.stub(EventReporterEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({}),
      } as any);

      await service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'First report',
        reporterAccountId: 'account-1',
        reporterType: 'authenticated',
        reporterIp: '192.168.1.100',
        reporterIpSubnet: '192.168.1.0',
        reporterIpRegion: 'US-CA',
      });

      await service.createReport({
        eventId: 'event-2',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'Second report',
        reporterAccountId: 'account-2',
        reporterType: 'authenticated',
        reporterIp: '192.168.1.200',
        reporterIpSubnet: '192.168.1.0',
        reporterIpRegion: 'US-CA',
      });

      // Different IPs should produce different hashes
      expect(capturedReports[0].reporterIpHash).not.toBe(capturedReports[1].reporterIpHash);
    });

    it('should handle IPv6 addresses', async () => {
      sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);

      let capturedReport: Report | null = null;
      sandbox.stub(ReportEntity, 'fromModel').callsFake((r: Report) => {
        capturedReport = r;
        return {
          save: sandbox.stub().resolves({ toModel: () => r }),
        } as any;
      });
      sandbox.stub(EventReporterEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({}),
      } as any);

      await service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'Test IPv6',
        reporterAccountId: 'account-1',
        reporterType: 'authenticated',
        reporterIp: '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
        reporterIpSubnet: '2001:0db8:85a3:0000',
        reporterIpRegion: 'US-CA',
      });

      expect(capturedReport).not.toBeNull();
      expect(capturedReport!.reporterIpHash).toBeTruthy();
      expect(capturedReport!.reporterIpHash!.length).toBe(64);
      expect(capturedReport!.reporterIpSubnet).toBe('2001:0db8:85a3:0000');
    });

    it('should handle missing IP data gracefully', async () => {
      sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);

      let capturedReport: Report | null = null;
      sandbox.stub(ReportEntity, 'fromModel').callsFake((r: Report) => {
        capturedReport = r;
        return {
          save: sandbox.stub().resolves({ toModel: () => r }),
        } as any;
      });
      sandbox.stub(EventReporterEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({}),
      } as any);

      // Create report without IP data
      await service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'No IP data',
        reporterAccountId: 'account-1',
        reporterType: 'authenticated',
      });

      expect(capturedReport).not.toBeNull();
      expect(capturedReport!.reporterIpHash).toBeNull();
      expect(capturedReport!.reporterIpSubnet).toBeNull();
      expect(capturedReport!.reporterIpRegion).toBeNull();
    });

    it('should handle "unknown" IP address gracefully', async () => {
      sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);

      let capturedReport: Report | null = null;
      sandbox.stub(ReportEntity, 'fromModel').callsFake((r: Report) => {
        capturedReport = r;
        return {
          save: sandbox.stub().resolves({ toModel: () => r }),
        } as any;
      });
      sandbox.stub(EventReporterEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({}),
      } as any);

      await service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'Unknown IP',
        reporterAccountId: 'account-1',
        reporterType: 'authenticated',
        reporterIp: 'unknown',
      });

      expect(capturedReport).not.toBeNull();
      // "unknown" should still be hashed but subnet/region may be null
      expect(capturedReport!.reporterIpHash).toBeTruthy();
    });

    it('should store IP data for anonymous reports', async () => {
      sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);
      sandbox.stub(service, 'hasExceededEmailRateLimit').resolves(false);
      sandbox.stub(service, 'isEmailBlocked' as any).resolves(false);

      let capturedReport: Report | null = null;
      sandbox.stub(ReportEntity, 'fromModel').callsFake((r: Report) => {
        capturedReport = r;
        return {
          save: sandbox.stub().resolves({ toModel: () => r }),
        } as any;
      });
      sandbox.stub(EventReporterEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({}),
      } as any);

      await service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'Anonymous with IP',
        reporterEmail: 'anon@example.com',
        reporterType: 'anonymous',
        reporterIp: '203.0.113.45',
        reporterIpSubnet: '203.0.113.0',
        reporterIpRegion: 'AU-NSW',
      });

      expect(capturedReport).not.toBeNull();
      expect(capturedReport!.reporterIpHash).toBeTruthy();
      expect(capturedReport!.reporterIpSubnet).toBe('203.0.113.0');
      expect(capturedReport!.reporterIpRegion).toBe('AU-NSW');
      expect(capturedReport!.status).toBe(ReportStatus.PENDING_VERIFICATION);
    });

    it('should store IP data for authenticated reports', async () => {
      sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);

      let capturedReport: Report | null = null;
      sandbox.stub(ReportEntity, 'fromModel').callsFake((r: Report) => {
        capturedReport = r;
        return {
          save: sandbox.stub().resolves({ toModel: () => r }),
        } as any;
      });
      sandbox.stub(EventReporterEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({}),
      } as any);

      await service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'Authenticated with IP',
        reporterAccountId: 'account-1',
        reporterType: 'authenticated',
        reporterIp: '198.51.100.89',
        reporterIpSubnet: '198.51.100.0',
        reporterIpRegion: 'UK-LON',
      });

      expect(capturedReport).not.toBeNull();
      expect(capturedReport!.reporterIpHash).toBeTruthy();
      expect(capturedReport!.reporterIpSubnet).toBe('198.51.100.0');
      expect(capturedReport!.reporterIpRegion).toBe('UK-LON');
      expect(capturedReport!.status).toBe(ReportStatus.SUBMITTED);
    });

    it('should store IP data for administrator reports', async () => {
      sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);

      let capturedReport: Report | null = null;
      sandbox.stub(ReportEntity, 'fromModel').callsFake((r: Report) => {
        capturedReport = r;
        return {
          save: sandbox.stub().resolves({ toModel: () => r }),
        } as any;
      });
      sandbox.stub(EventReporterEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({}),
      } as any);

      await service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'Admin report with IP',
        reporterAccountId: 'admin-1',
        reporterType: 'administrator',
        adminId: 'admin-1',
        adminPriority: 'high',
        reporterIp: '10.0.0.5',
        reporterIpSubnet: '10.0.0.0',
        reporterIpRegion: 'US-VA',
      });

      expect(capturedReport).not.toBeNull();
      expect(capturedReport!.reporterIpHash).toBeTruthy();
      expect(capturedReport!.reporterIpSubnet).toBe('10.0.0.0');
      expect(capturedReport!.reporterIpRegion).toBe('US-VA');
      expect(capturedReport!.adminId).toBe('admin-1');
    });
  });
});
