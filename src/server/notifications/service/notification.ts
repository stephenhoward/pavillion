import { Op } from 'sequelize';
import striptags from 'striptags';
import he from 'he';

import { Notification } from '@/common/model/notification';
import { NotificationEntity } from '@/server/notifications/entity/notification';

/**
 * Bidi control characters to strip from actor names before storage.
 * These can be used to spoof displayed text direction.
 */
const BIDI_CONTROL_RE = /[\u200F\u202E\u2066-\u2069]/g;

/**
 * Deduplication window in milliseconds (10 minutes).
 */
const DEDUP_WINDOW_MS = 10 * 60 * 1000;

/**
 * Maximum number of notifications returned when no limit is specified.
 */
const DEFAULT_LIMIT = 50;

/**
 * Upper cap on the number of notifications returned per request.
 */
const MAX_LIMIT = 100;

/**
 * Upper cap on the offset value to prevent unreasonable skip values.
 */
const MAX_OFFSET = 10000;

/**
 * Number of days after which seen notifications are deleted.
 */
const SEEN_RETENTION_DAYS = 7;

/**
 * Number of days after which all notifications are deleted regardless of seen status.
 */
const MAX_RETENTION_DAYS = 90;

/**
 * Service class that encapsulates all business logic for notifications.
 *
 * Notification records are created when an ActivityPub inbox processes
 * a Follow or Announce activity directed at a local calendar. Notifications
 * are scoped per account so that all calendar editors receive copies.
 */
class NotificationService {

  /**
   * Sanitizes an actor_name string before it is persisted.
   *
   * Steps:
   * 1. Decode HTML entities (e.g. &lt;script&gt; → <script>)
   * 2. Strip HTML tags using a well-tested library
   * 3. Remove Unicode bidirectional control characters
   * 4. Truncate to 256 characters
   *
   * @param {string} raw - Raw actor name from the ActivityPub payload
   * @returns {string} Sanitized actor name, safe for storage and display
   */
  sanitizeActorName(raw: string): string {
    // Step 1: Decode HTML entities so that encoded tags become real tags
    // before we strip them (e.g. &lt;script&gt; → <script>)
    const decoded = he.decode(raw);

    // Step 2: Strip any remaining HTML tags
    const stripped = striptags(decoded);

    // Step 3: Remove bidi control characters
    const noBidi = stripped.replace(BIDI_CONTROL_RE, '');

    // Step 4: Truncate
    return noBidi.slice(0, 256);
  }

  /**
   * Creates a notification record after performing actor_name sanitization
   * and deduplication checks.
   *
   * Deduplication: if a notification with the same (type, actor_url,
   * calendar_id) was inserted within the last 10 minutes, the insertion
   * is skipped silently and this method returns null.
   *
   * @param {string} type - Notification type: 'follow' or 'repost'
   * @param {string} calendarId - UUID of the calendar being followed or whose event was reposted
   * @param {string | null} eventId - UUID of the reposted event, or null for follows
   * @param {string} actorName - Raw display name of the actor (will be sanitized)
   * @param {string | null} actorUrl - URL of the actor (validated upstream by AP inbox)
   * @param {string} accountId - UUID of the account to notify
   * @returns {Promise<Notification | null>} The created Notification model, or null if deduplicated
   */
  async createNotification(
    type: string,
    calendarId: string,
    eventId: string | null,
    actorName: string,
    actorUrl: string | null,
    accountId: string,
  ): Promise<Notification | null> {
    // Deduplication check: look for a matching record within the window
    const dedupCutoff = new Date(Date.now() - DEDUP_WINDOW_MS);
    const existing = await NotificationEntity.findOne({
      where: {
        type,
        actor_url: actorUrl,
        calendar_id: calendarId,
        created_at: { [Op.gte]: dedupCutoff },
      },
    });

    if (existing) {
      return null;
    }

    const sanitizedName = this.sanitizeActorName(actorName);

    const notification = new Notification();
    notification.type = type;
    notification.calendarId = calendarId;
    notification.eventId = eventId;
    notification.actorName = sanitizedName;
    notification.actorUrl = actorUrl;
    notification.seen = false;

    const entity = NotificationEntity.fromModel(notification, accountId);
    await entity.save();

    return entity.toModel();
  }

  /**
   * Returns notifications for the given account, ordered by creation date
   * descending (most recent first).
   *
   * @param {string} accountId - The account whose notifications to fetch
   * @param {number} [limit=50] - Number of records to return (capped at 100)
   * @param {number} [offset=0] - Number of records to skip (capped at 10000)
   * @returns {Promise<Notification[]>} Array of Notification domain models
   */
  async getNotificationsForAccount(accountId: string, limit: number = DEFAULT_LIMIT, offset: number = 0): Promise<Notification[]> {
    const effectiveLimit = Math.min(limit, MAX_LIMIT);
    const effectiveOffset = Math.max(0, Math.min(offset, MAX_OFFSET));

    const entities = await NotificationEntity.findAll({
      where: { account_id: accountId },
      order: [['created_at', 'DESC']],
      limit: effectiveLimit,
      offset: effectiveOffset,
    });

    return entities.map(entity => entity.toModel());
  }

  /**
   * Marks all unseen notifications for the specified account as seen.
   * Scoped strictly to the requesting account to prevent IDOR.
   *
   * @param {string} accountId - The account whose notifications to mark seen
   * @returns {Promise<void>}
   */
  async markAllSeenForAccount(accountId: string): Promise<void> {
    await NotificationEntity.update(
      { seen: true },
      {
        where: {
          account_id: accountId,
          seen: false,
        },
      },
    );
  }

  /**
   * Deletes old notifications in two passes:
   * 1. Seen notifications older than 7 days
   * 2. Any notifications older than 90 days (including unseen)
   *
   * This method is called by a scheduled job and must never be exposed
   * via an API endpoint.
   *
   * @returns {Promise<void>}
   */
  async deleteOldNotifications(): Promise<void> {
    const seenCutoff = new Date(Date.now() - SEEN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const maxCutoff = new Date(Date.now() - MAX_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    // Pass 1: Delete seen notifications older than 7 days
    await NotificationEntity.destroy({
      where: {
        seen: true,
        created_at: { [Op.lt]: seenCutoff },
      },
    });

    // Pass 2: Delete all notifications older than 90 days
    await NotificationEntity.destroy({
      where: {
        created_at: { [Op.lt]: maxCutoff },
      },
    });
  }
}

export default NotificationService;
