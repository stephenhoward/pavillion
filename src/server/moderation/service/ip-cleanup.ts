import { Op } from 'sequelize';
import { ReportEntity } from '@/server/moderation/entity/report';

/**
 * Result object returned by IP cleanup operations.
 */
export interface IpCleanupResult {
  hashCleared: number;
  subnetCleared: number;
}

/**
 * Service for managing tiered IP data retention in reports.
 *
 * Implements a privacy-preserving retention policy:
 * - ip_hash: cleared after 30 days (default)
 * - ip_subnet: cleared after 90 days (default)
 * - ip_region: kept indefinitely for analytics
 */
class IpCleanupService {
  /**
   * Cleans up expired IP data based on tiered retention policies.
   *
   * Uses efficient bulk UPDATE queries to clear IP data for reports
   * older than the specified retention periods.
   *
   * @param hashRetentionDays - Days to retain ip_hash (default: 30)
   * @param subnetRetentionDays - Days to retain ip_subnet (default: 90)
   * @returns Object with counts of affected records
   *
   * @example
   * const service = new IpCleanupService();
   * const result = await service.cleanupExpiredIpData();
   * console.log(`Cleared ${result.hashCleared} ip_hash values`);
   * console.log(`Cleared ${result.subnetCleared} ip_subnet values`);
   */
  async cleanupExpiredIpData(
    hashRetentionDays: number = 30,
    subnetRetentionDays: number = 90,
  ): Promise<IpCleanupResult> {
    console.log(`[IP Cleanup] Starting IP data cleanup with retention policy: ip_hash=${hashRetentionDays} days, ip_subnet=${subnetRetentionDays} days`);

    try {
      // Calculate date thresholds
      const hashThreshold = new Date(Date.now() - hashRetentionDays * 24 * 60 * 60 * 1000);
      const subnetThreshold = new Date(Date.now() - subnetRetentionDays * 24 * 60 * 60 * 1000);

      console.log(`[IP Cleanup] Hash threshold: reports created before ${hashThreshold.toISOString()}`);
      console.log(`[IP Cleanup] Subnet threshold: reports created before ${subnetThreshold.toISOString()}`);

      // Clear ip_hash for reports older than hashRetentionDays
      const [hashCleared] = await ReportEntity.update(
        { ip_hash: null },
        {
          where: {
            ip_hash: { [Op.ne]: null },
            created_at: { [Op.lt]: hashThreshold },
          },
        },
      );

      console.log(`[IP Cleanup] Cleared ip_hash from ${hashCleared} report(s) older than ${hashRetentionDays} days`);

      // Clear ip_subnet for reports older than subnetRetentionDays
      const [subnetCleared] = await ReportEntity.update(
        { ip_subnet: null },
        {
          where: {
            ip_subnet: { [Op.ne]: null },
            created_at: { [Op.lt]: subnetThreshold },
          },
        },
      );

      console.log(`[IP Cleanup] Cleared ip_subnet from ${subnetCleared} report(s) older than ${subnetRetentionDays} days`);

      console.log(`[IP Cleanup] Cleanup completed successfully: ${hashCleared} hash(es) cleared, ${subnetCleared} subnet(s) cleared`);

      return {
        hashCleared,
        subnetCleared,
      };
    }
    catch (error) {
      console.error('[IP Cleanup] Cleanup operation failed:', error);
      throw error;
    }
  }
}

export default IpCleanupService;
