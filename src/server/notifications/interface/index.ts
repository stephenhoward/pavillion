import { Notification } from '@/common/model/notification';
import NotificationService from '@/server/notifications/service/notification';

export default class NotificationsInterface {
  private service: NotificationService;

  constructor(service: NotificationService) {
    this.service = service;
  }

  /**
   * Returns notifications for the given account, ordered by creation date
   * descending (most recent first).
   *
   * @param {string} accountId - The account whose notifications to fetch
   * @param {number} [limit] - Number of records to return (default 50, max 100)
   * @param {number} [offset] - Number of records to skip (default 0, max 10000)
   * @returns {Promise<Notification[]>} Array of Notification domain models
   */
  async getNotificationsForAccount(accountId: string, limit?: number, offset?: number): Promise<Notification[]> {
    return this.service.getNotificationsForAccount(accountId, limit, offset);
  }

  /**
   * Marks all unseen notifications for the specified account as seen.
   *
   * @param {string} accountId - The account whose notifications to mark seen
   * @returns {Promise<void>}
   */
  async markAllSeenForAccount(accountId: string): Promise<void> {
    return this.service.markAllSeenForAccount(accountId);
  }

  /**
   * Deletes old notifications per retention policy.
   * Called by the scheduled cleanup job.
   *
   * @returns {Promise<void>}
   */
  async deleteOldNotifications(): Promise<void> {
    return this.service.deleteOldNotifications();
  }
}
