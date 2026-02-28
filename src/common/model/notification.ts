import { PrimaryModel } from '@/common/model/model';

/**
 * Represents a notification for a calendar owner or editor.
 * Notification types are 'follow' (someone followed a calendar)
 * or 'repost' (someone reposted an event).
 *
 * Note: account_id is intentionally excluded from toObject() so that
 * notifications can be safely serialized for API responses without
 * leaking the internal account identifier.
 */
class Notification extends PrimaryModel {
  type: string = '';
  calendarId: string = '';
  eventId: string | null = null;
  actorName: string = '';
  actorUrl: string | null = null;
  seen: boolean = false;
  createdAt: Date | null = null;

  /**
   * Constructor for Notification.
   *
   * @param {string} [id] - Unique identifier for the notification
   */
  constructor(id?: string) {
    super(id);
  }

  /**
   * Converts the notification to a plain JavaScript object suitable
   * for API responses. Excludes account_id intentionally.
   *
   * @returns {Record<string, any>} Plain object representation of the notification
   */
  toObject(): Record<string, any> {
    return {
      id: this.id,
      type: this.type,
      calendarId: this.calendarId,
      eventId: this.eventId,
      actorName: this.actorName,
      actorUrl: this.actorUrl,
      seen: this.seen,
      createdAt: this.createdAt,
    };
  }

  /**
   * Creates a Notification instance from a plain object (e.g., API response).
   *
   * @param {Record<string, any>} obj - Plain object containing notification data
   * @returns {Notification} A new Notification instance
   */
  static fromObject(obj: Record<string, any>): Notification {
    const notification = new Notification(obj.id);
    notification.type = obj.type ?? '';
    notification.calendarId = obj.calendarId ?? '';
    notification.eventId = obj.eventId ?? null;
    notification.actorName = obj.actorName ?? '';
    notification.actorUrl = obj.actorUrl ?? null;
    notification.seen = obj.seen ?? false;
    notification.createdAt = obj.createdAt ?? null;
    return notification;
  }
}

export { Notification };
