import { Op } from 'sequelize';
import db from '@/server/common/entity/db';
import { ReportEntity } from '@/server/moderation/entity/report';
import { EventReporterEntity } from '@/server/moderation/entity/event_reporter';
import { ReportEscalationEntity } from '@/server/moderation/entity/report_escalation';
import { ReportStatus } from '@/common/model/report';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('moderation');

/**
 * Optional narrowing of a cleanup to one reporter's reports on one event.
 */
export interface UnverifiedReportCleanupScope {
  eventId: string;
  reporterIdentifier: string;
}

/**
 * Result object returned by unverified-report cleanup.
 */
export interface UnverifiedReportCleanupResult {
  reportsDeleted: number;
  reporterRowsDeleted: number;
}

/**
 * Removes anonymous reports whose email verification window has passed.
 *
 * An unverified report was never confirmed by its reporter, so deleting it
 * loses no moderation record, and it ends the retention of the reporter's
 * email hash and IP data. Only `pending_verification` reports are touched:
 * a report an owner acted on is kept even if its expiry has passed.
 */
class UnverifiedReportCleanupService {
  /**
   * Deletes expired pending_verification reports with their event_reporter
   * and (defensively) escalation rows.
   *
   * @param scope - Restrict to one reporter's reports on one event
   * @returns Counts of deleted rows
   */
  async cleanupExpiredUnverifiedReports(
    scope?: UnverifiedReportCleanupScope,
  ): Promise<UnverifiedReportCleanupResult> {
    const where: Record<string, unknown> = {
      status: ReportStatus.PENDING_VERIFICATION,
      verification_expiration: { [Op.lt]: new Date() },
    };
    if (scope) {
      where.event_id = scope.eventId;
      where.reporter_email_hash = scope.reporterIdentifier;
    }

    const result = await db.transaction(async (transaction) => {
      const rows = await ReportEntity.findAll({ attributes: ['id'], where, transaction });
      const ids = rows.map((row) => row.id);
      if (ids.length === 0) {
        return { reportsDeleted: 0, reporterRowsDeleted: 0 };
      }

      const reporterRowsDeleted = await EventReporterEntity.destroy({ where: { report_id: { [Op.in]: ids } }, transaction });
      await ReportEscalationEntity.destroy({ where: { report_id: { [Op.in]: ids } }, transaction });
      // Re-assert the status so a report resolved since the select survives.
      const reportsDeleted = await ReportEntity.destroy({
        where: { id: { [Op.in]: ids }, status: ReportStatus.PENDING_VERIFICATION },
        transaction,
      });
      return { reportsDeleted, reporterRowsDeleted };
    });

    if (result.reportsDeleted > 0) {
      logger.info(result, 'Deleted expired unverified reports');
    }
    return result;
  }
}

export default UnverifiedReportCleanupService;
