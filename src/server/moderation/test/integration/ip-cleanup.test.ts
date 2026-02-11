import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { DateTime } from 'luxon';

import { ReportEntity } from '@/server/moderation/entity/report';
import IpCleanupService from '@/server/moderation/service/ip-cleanup';
import { ReportStatus, ReportCategory } from '@/common/model/report';
import { TestEnvironment } from '@/server/test/lib/test_environment';

describe('IpCleanupService Integration', () => {
  let service: IpCleanupService;
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  beforeEach(() => {
    service = new IpCleanupService();
  });

  afterEach(async () => {
    // Clean up test data
    await ReportEntity.destroy({ where: {} });
  });

  describe('cleanupExpiredIpData', () => {
    it('should clear ip_hash for reports older than 30 days', async () => {
      // Create report older than 30 days with ip_hash
      const oldReport = await ReportEntity.create({
        id: '11111111-1111-1111-1111-111111111111',
        event_id: 'event1',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Old report with IP data',
        reporter_type: 'anonymous',
        status: ReportStatus.SUBMITTED,
        ip_hash: 'abc123hash',
        ip_subnet: '192.168.1.0',
        ip_region: 'US-CA',
        created_at: DateTime.now().minus({ days: 31 }).toJSDate(),
      });

      // Create recent report with ip_hash (should not be cleared)
      const recentReport = await ReportEntity.create({
        id: '22222222-2222-2222-2222-222222222222',
        event_id: 'event2',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Recent report with IP data',
        reporter_type: 'anonymous',
        status: ReportStatus.SUBMITTED,
        ip_hash: 'def456hash',
        ip_subnet: '192.168.2.0',
        ip_region: 'US-NY',
        created_at: DateTime.now().minus({ days: 15 }).toJSDate(),
      });

      const result = await service.cleanupExpiredIpData();

      expect(result.hashCleared).toBe(1);

      // Verify old report had ip_hash cleared
      const updatedOld = await ReportEntity.findByPk(oldReport.id);
      expect(updatedOld!.ip_hash).toBeNull();
      expect(updatedOld!.ip_subnet).toBe('192.168.1.0'); // Still present
      expect(updatedOld!.ip_region).toBe('US-CA'); // Still present

      // Verify recent report still has ip_hash
      const updatedRecent = await ReportEntity.findByPk(recentReport.id);
      expect(updatedRecent!.ip_hash).toBe('def456hash');
      expect(updatedRecent!.ip_subnet).toBe('192.168.2.0');
      expect(updatedRecent!.ip_region).toBe('US-NY');
    });

    it('should clear ip_subnet for reports older than 90 days', async () => {
      // Create report older than 90 days with ip_subnet (hash already null)
      const veryOldReport = await ReportEntity.create({
        id: '33333333-3333-3333-3333-333333333333',
        event_id: 'event3',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Very old report',
        reporter_type: 'anonymous',
        status: ReportStatus.SUBMITTED,
        ip_hash: null,
        ip_subnet: '10.0.0.0',
        ip_region: 'US-CA',
        created_at: DateTime.now().minus({ days: 91 }).toJSDate(),
      });

      // Create report older than 30 days but less than 90 days
      const middleAgeReport = await ReportEntity.create({
        id: '44444444-4444-4444-4444-444444444444',
        event_id: 'event4',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Middle age report',
        reporter_type: 'anonymous',
        status: ReportStatus.SUBMITTED,
        ip_hash: 'ghi789hash',
        ip_subnet: '172.16.0.0',
        ip_region: 'US-TX',
        created_at: DateTime.now().minus({ days: 60 }).toJSDate(),
      });

      const result = await service.cleanupExpiredIpData();

      expect(result.subnetCleared).toBe(1);

      // Verify very old report had ip_subnet cleared
      const updatedVeryOld = await ReportEntity.findByPk(veryOldReport.id);
      expect(updatedVeryOld!.ip_hash).toBeNull();
      expect(updatedVeryOld!.ip_subnet).toBeNull(); // Cleared
      expect(updatedVeryOld!.ip_region).toBe('US-CA'); // Still present

      // Verify middle age report still has ip_subnet
      const updatedMiddle = await ReportEntity.findByPk(middleAgeReport.id);
      expect(updatedMiddle!.ip_hash).toBeNull(); // Cleared by hash policy
      expect(updatedMiddle!.ip_subnet).toBe('172.16.0.0'); // Still present
      expect(updatedMiddle!.ip_region).toBe('US-TX');
    });

    it('should keep ip_region indefinitely', async () => {
      // Create very old report (180 days old)
      const ancientReport = await ReportEntity.create({
        id: '55555555-5555-5555-5555-555555555555',
        event_id: 'event5',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Ancient report',
        reporter_type: 'anonymous',
        status: ReportStatus.RESOLVED,
        ip_hash: null,
        ip_subnet: null,
        ip_region: 'GB-LND',
        created_at: DateTime.now().minus({ days: 180 }).toJSDate(),
      });

      await service.cleanupExpiredIpData();

      // Verify ip_region is still present
      const updated = await ReportEntity.findByPk(ancientReport.id);
      expect(updated!.ip_hash).toBeNull();
      expect(updated!.ip_subnet).toBeNull();
      expect(updated!.ip_region).toBe('GB-LND'); // Still present after 180 days
    });

    it('should use custom retention periods', async () => {
      // Create report 25 days old
      const report = await ReportEntity.create({
        id: '66666666-6666-6666-6666-666666666666',
        event_id: 'event6',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Report for custom retention test',
        reporter_type: 'anonymous',
        status: ReportStatus.SUBMITTED,
        ip_hash: 'jkl012hash',
        ip_subnet: '192.168.3.0',
        ip_region: 'US-FL',
        created_at: DateTime.now().minus({ days: 25 }).toJSDate(),
      });

      // Use 10 day retention for hash (should clear - report is 25 days old)
      // Use 20 day retention for subnet (should also clear - report is 25 days old)
      const result = await service.cleanupExpiredIpData(10, 20);

      expect(result.hashCleared).toBe(1);
      expect(result.subnetCleared).toBe(1);

      // Verify both ip_hash and ip_subnet were cleared
      const updated = await ReportEntity.findByPk(report.id);
      expect(updated!.ip_hash).toBeNull();
      expect(updated!.ip_subnet).toBeNull();
      expect(updated!.ip_region).toBe('US-FL');
    });

    it('should handle reports with already null IP data', async () => {
      // Create report with already null IP data
      await ReportEntity.create({
        id: '77777777-7777-7777-7777-777777777777',
        event_id: 'event7',
        calendar_id: 'cal1',
        category: ReportCategory.SPAM,
        description: 'Report with null IP data',
        reporter_type: 'anonymous',
        status: ReportStatus.SUBMITTED,
        ip_hash: null,
        ip_subnet: null,
        ip_region: 'US-WA',
        created_at: DateTime.now().minus({ days: 100 }).toJSDate(),
      });

      const result = await service.cleanupExpiredIpData();

      // Should not count already-null records
      expect(result.hashCleared).toBe(0);
      expect(result.subnetCleared).toBe(0);
    });

    it('should handle empty database gracefully', async () => {
      const result = await service.cleanupExpiredIpData();

      expect(result.hashCleared).toBe(0);
      expect(result.subnetCleared).toBe(0);
    });

    it('should handle multiple reports at different ages correctly', async () => {
      // Create 5 reports at different ages
      await ReportEntity.bulkCreate([
        {
          id: '88888888-8888-8888-8888-888888888888',
          event_id: 'event8',
          calendar_id: 'cal1',
          category: ReportCategory.SPAM,
          description: 'Report 1',
          reporter_type: 'anonymous',
          status: ReportStatus.SUBMITTED,
          ip_hash: 'hash1',
          ip_subnet: 'subnet1',
          ip_region: 'US-CA',
          created_at: DateTime.now().minus({ days: 10 }).toJSDate(),
        },
        {
          id: '99999999-9999-9999-9999-999999999999',
          event_id: 'event9',
          calendar_id: 'cal1',
          category: ReportCategory.SPAM,
          description: 'Report 2',
          reporter_type: 'anonymous',
          status: ReportStatus.SUBMITTED,
          ip_hash: 'hash2',
          ip_subnet: 'subnet2',
          ip_region: 'US-NY',
          created_at: DateTime.now().minus({ days: 35 }).toJSDate(),
        },
        {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          event_id: 'event10',
          calendar_id: 'cal1',
          category: ReportCategory.SPAM,
          description: 'Report 3',
          reporter_type: 'anonymous',
          status: ReportStatus.SUBMITTED,
          ip_hash: 'hash3',
          ip_subnet: 'subnet3',
          ip_region: 'US-TX',
          created_at: DateTime.now().minus({ days: 60 }).toJSDate(),
        },
        {
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          event_id: 'event11',
          calendar_id: 'cal1',
          category: ReportCategory.SPAM,
          description: 'Report 4',
          reporter_type: 'anonymous',
          status: ReportStatus.SUBMITTED,
          ip_hash: 'hash4',
          ip_subnet: 'subnet4',
          ip_region: 'US-FL',
          created_at: DateTime.now().minus({ days: 95 }).toJSDate(),
        },
        {
          id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          event_id: 'event12',
          calendar_id: 'cal1',
          category: ReportCategory.SPAM,
          description: 'Report 5',
          reporter_type: 'anonymous',
          status: ReportStatus.SUBMITTED,
          ip_hash: 'hash5',
          ip_subnet: 'subnet5',
          ip_region: 'US-WA',
          created_at: DateTime.now().minus({ days: 120 }).toJSDate(),
        },
      ]);

      const result = await service.cleanupExpiredIpData();

      // 4 reports > 30 days (should clear hash)
      expect(result.hashCleared).toBe(4);
      // 2 reports > 90 days (should clear subnet)
      expect(result.subnetCleared).toBe(2);

      // Verify specific records
      const report1 = await ReportEntity.findByPk('88888888-8888-8888-8888-888888888888');
      expect(report1!.ip_hash).toBe('hash1'); // Recent, kept
      expect(report1!.ip_subnet).toBe('subnet1');

      const report2 = await ReportEntity.findByPk('99999999-9999-9999-9999-999999999999');
      expect(report2!.ip_hash).toBeNull(); // > 30 days, cleared
      expect(report2!.ip_subnet).toBe('subnet2'); // < 90 days, kept

      const report4 = await ReportEntity.findByPk('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
      expect(report4!.ip_hash).toBeNull(); // > 30 days, cleared
      expect(report4!.ip_subnet).toBeNull(); // > 90 days, cleared
      expect(report4!.ip_region).toBe('US-FL'); // Always kept
    });
  });
});
