import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { ReportEntity } from '@/server/moderation/entity/report';
import IpCleanupService from '@/server/moderation/service/ip-cleanup';

describe('IpCleanupService', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('cleanupExpiredIpData', () => {
    it('should clear ip_hash for reports older than 30 days by default', async () => {
      const service = new IpCleanupService();
      const mockUpdate = sandbox.stub(ReportEntity, 'update').resolves([5, []]);

      const result = await service.cleanupExpiredIpData();

      // Check that ip_hash was cleared
      expect(mockUpdate.callCount).toBeGreaterThanOrEqual(1);
      const hashCall = mockUpdate.getCalls().find(call =>
        call.args[0].ip_hash === null,
      );
      expect(hashCall).toBeDefined();

      // Verify result structure
      expect(result).toHaveProperty('hashCleared');
      expect(result).toHaveProperty('subnetCleared');
    });

    it('should clear ip_subnet for reports older than 90 days by default', async () => {
      const service = new IpCleanupService();
      const mockUpdate = sandbox.stub(ReportEntity, 'update').resolves([3, []]);

      const result = await service.cleanupExpiredIpData();

      // Check that ip_subnet was cleared
      expect(mockUpdate.callCount).toBeGreaterThanOrEqual(1);
      const subnetCall = mockUpdate.getCalls().find(call =>
        call.args[0].ip_subnet === null,
      );
      expect(subnetCall).toBeDefined();

      // Verify result structure
      expect(result).toHaveProperty('hashCleared');
      expect(result).toHaveProperty('subnetCleared');
    });

    it('should keep ip_region indefinitely', async () => {
      const service = new IpCleanupService();
      const mockUpdate = sandbox.stub(ReportEntity, 'update').resolves([5, []]);

      await service.cleanupExpiredIpData();

      // Verify no update call sets ip_region to null
      for (const call of mockUpdate.getCalls()) {
        expect(call.args[0]).not.toHaveProperty('ip_region');
      }
    });

    it('should return count of affected records', async () => {
      const service = new IpCleanupService();
      sandbox.stub(ReportEntity, 'update')
        .onFirstCall().resolves([5, []]) // hash cleanup
        .onSecondCall().resolves([3, []]); // subnet cleanup

      const result = await service.cleanupExpiredIpData();

      expect(result.hashCleared).toBe(5);
      expect(result.subnetCleared).toBe(3);
    });

    it('should use custom retention periods when provided', async () => {
      const service = new IpCleanupService();
      const mockUpdate = sandbox.stub(ReportEntity, 'update').resolves([2, []]);

      await service.cleanupExpiredIpData(10, 20);

      // Verify the date calculations use the custom periods
      expect(mockUpdate.callCount).toBe(2);

      // First call should be for 10 days ago (hash)
      const hashCall = mockUpdate.firstCall;
      expect(hashCall.args[0].ip_hash).toBeNull();

      // Second call should be for 20 days ago (subnet)
      const subnetCall = mockUpdate.secondCall;
      expect(subnetCall.args[0].ip_subnet).toBeNull();
    });

    it('should only clear ip_hash where it is not already null', async () => {
      const service = new IpCleanupService();
      const mockUpdate = sandbox.stub(ReportEntity, 'update').resolves([5, []]);

      await service.cleanupExpiredIpData();

      // Check the WHERE clause includes ip_hash IS NOT NULL
      const hashCall = mockUpdate.getCalls().find(call =>
        call.args[0].ip_hash === null,
      );
      expect(hashCall).toBeDefined();
      expect(hashCall!.args[1].where).toBeDefined();
    });

    it('should only clear ip_subnet where it is not already null', async () => {
      const service = new IpCleanupService();
      const mockUpdate = sandbox.stub(ReportEntity, 'update').resolves([3, []]);

      await service.cleanupExpiredIpData();

      // Check the WHERE clause includes ip_subnet IS NOT NULL
      const subnetCall = mockUpdate.getCalls().find(call =>
        call.args[0].ip_subnet === null,
      );
      expect(subnetCall).toBeDefined();
      expect(subnetCall!.args[1].where).toBeDefined();
    });

    it('should handle zero affected records gracefully', async () => {
      const service = new IpCleanupService();
      sandbox.stub(ReportEntity, 'update').resolves([0, []]);

      const result = await service.cleanupExpiredIpData();

      expect(result.hashCleared).toBe(0);
      expect(result.subnetCleared).toBe(0);
    });

    it('should calculate correct date thresholds for hash cleanup', async () => {
      const service = new IpCleanupService();
      const mockUpdate = sandbox.stub(ReportEntity, 'update').resolves([5, []]);

      const beforeCall = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await service.cleanupExpiredIpData(30, 90);
      const afterCall = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // Verify date threshold is approximately correct (within 1 second)
      const hashCall = mockUpdate.getCalls().find(call =>
        call.args[0].ip_hash === null,
      );
      expect(hashCall).toBeDefined();
      const whereClause = hashCall!.args[1].where as any;

      // The created_at threshold should be between beforeCall and afterCall
      if (whereClause.created_at) {
        const threshold = whereClause.created_at.$lt || whereClause.created_at[Symbol.for('lt')];
        expect(threshold.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime() - 1000);
        expect(threshold.getTime()).toBeLessThanOrEqual(afterCall.getTime() + 1000);
      }
    });

    it('should calculate correct date thresholds for subnet cleanup', async () => {
      const service = new IpCleanupService();
      const mockUpdate = sandbox.stub(ReportEntity, 'update').resolves([3, []]);

      const beforeCall = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      await service.cleanupExpiredIpData(30, 90);
      const afterCall = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

      // Verify date threshold is approximately correct (within 1 second)
      const subnetCall = mockUpdate.getCalls().find(call =>
        call.args[0].ip_subnet === null,
      );
      expect(subnetCall).toBeDefined();
      const whereClause = subnetCall!.args[1].where as any;

      // The created_at threshold should be between beforeCall and afterCall
      if (whereClause.created_at) {
        const threshold = whereClause.created_at.$lt || whereClause.created_at[Symbol.for('lt')];
        expect(threshold.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime() - 1000);
        expect(threshold.getTime()).toBeLessThanOrEqual(afterCall.getTime() + 1000);
      }
    });
  });
});
