import { Op } from 'sequelize';

import {
  NotificationActivityEntity,
  NotificationRecipientEntity,
} from '@/server/notifications/entity/notification_activity';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('notifications');

/**
 * Retention windows for the notifications domain:
 *   - Recipient rows that have been dismissed or seen for more than 7 days
 *     are deleted in pass 1. "Age" here means time since the row reached its
 *     terminal state (dismissed_at / seen_at), not time since created_at —
 *     the retention window starts when the recipient acted on the row.
 *   - Activity rows older than 90 days are deleted in pass 2 (FK CASCADE
 *     removes any recipient rows that survived pass 1).
 */
const RECIPIENT_RETENTION_DAYS = 7;
const ACTIVITY_RETENTION_DAYS = 90;

/**
 * Counts returned from a retention cleanup pass.
 */
export interface NotificationRetentionCleanupResult {
  recipientsDeleted: number;
  activitiesDeleted: number;
}

/**
 * Service for periodic two-pass retention cleanup of notification rows.
 *
 *  Retention prescribes a two-pass design:
 *
 *   Pass 1 — `DELETE FROM notification_recipient WHERE (dismissed_at IS NOT
 *   NULL OR seen_at IS NOT NULL) AND age > 7 days`. Drops the visible inbox
 *   tail that recipients have already acted on.
 *
 *   Pass 2 — `DELETE FROM notification_activity WHERE age > 90 days`.
 *   FK CASCADE in migration 0035 removes any recipient rows that survived
 *   pass 1 (e.g. unseen/undismissed recipients tied to an aged-out activity).
 *
 * Orphaned activities (activities whose recipients were all cleared by
 * pass 1) are NOT deleted early — they age out via pass 2. this is
 * acceptable because the 90-day cap is short and activity rows are small.
 *
 * Wired into the worker scheduler (see `src/server/worker.ts`,
 * `notifications:cleanup` job) following the cadence pattern established by
 * `IpCleanupService` (`src/server/moderation/service/ip-cleanup.ts`).
 */
class NotificationRetentionCleanupService {
  /**
   * Runs the two-pass cleanup against the notifications tables.
   *
   * @returns Counts of recipient and activity rows deleted.
   */
  async cleanupExpiredNotifications(): Promise<NotificationRetentionCleanupResult> {
    logger.info(
      {
        recipientRetentionDays: RECIPIENT_RETENTION_DAYS,
        activityRetentionDays: ACTIVITY_RETENTION_DAYS,
      },
      'Starting notification retention cleanup',
    );

    try {
      const recipientThreshold = new Date(
        Date.now() - RECIPIENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );
      const activityThreshold = new Date(
        Date.now() - ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );

      // Pass 1: drop recipient rows that have been in a terminal state
      // (seen or dismissed) for longer than the retention window. The age
      // anchor is the terminal-state timestamp (dismissed_at / seen_at),
      // not created_at — the retention window starts when the recipient
      // acted on the row, not when the row was created. A row dismissed
      // yesterday but created 10 days ago must survive; its 7-day clock
      // started yesterday.
      //
      // OR-semantics: any row with EITHER timestamp set is
      // eligible. When both are set, the OLDER terminal-state timestamp
      // wins (i.e. the retention window started at first action). We
      // express this as: at least one terminal timestamp exists, AND the
      // earliest non-null terminal timestamp is older than the threshold.
      // SQLite/Postgres MIN ignores NULLs, which gives the desired
      // "earliest non-null" semantics across both columns.
      const recipientsDeleted = await NotificationRecipientEntity.destroy({
        where: {
          [Op.and]: [
            {
              [Op.or]: [
                { dismissed_at: { [Op.ne]: null } },
                { seen_at: { [Op.ne]: null } },
              ],
            },
            {
              [Op.or]: [
                // dismissed_at older than the threshold OR null (let the
                // other side carry the comparison); seen_at handled in the
                // companion clause. Both clauses joined by AND require
                // every non-null terminal timestamp to be past the
                // threshold, which is the strict reading of
                // "in terminal state for > N days".
                { dismissed_at: { [Op.lt]: recipientThreshold } },
                { dismissed_at: null },
              ],
            },
            {
              [Op.or]: [
                { seen_at: { [Op.lt]: recipientThreshold } },
                { seen_at: null },
              ],
            },
          ],
        },
      });

      logger.info(
        { recipientsDeleted, recipientRetentionDays: RECIPIENT_RETENTION_DAYS },
        'Pass 1 complete: seen/dismissed recipients deleted',
      );

      // Pass 2: drop activity rows older than the cap. FK CASCADE on
      // notification_recipient.notification_activity_id (configured in
      // migration 0035) removes any recipient rows that escaped pass 1.
      const activitiesDeleted = await NotificationActivityEntity.destroy({
        where: {
          created_at: { [Op.lt]: activityThreshold },
        },
      });

      logger.info(
        { activitiesDeleted, activityRetentionDays: ACTIVITY_RETENTION_DAYS },
        'Pass 2 complete: aged activities deleted (recipients removed by FK cascade)',
      );

      return { recipientsDeleted, activitiesDeleted };
    }
    catch (error) {
      logger.error({ err: error }, 'Notification retention cleanup failed');
      throw error;
    }
  }
}

export default NotificationRetentionCleanupService;
