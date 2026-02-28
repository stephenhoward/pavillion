import axios from 'axios';
import { Notification } from '@/common/model/notification';

/**
 * Client service for notification API endpoints.
 */
export default class NotificationService {

  /**
   * Fetch notifications for the logged-in user.
   *
   * @param limit - Maximum number of notifications to return (default 50, max 100)
   * @returns Promise resolving to an array of Notification instances
   */
  async getNotifications(limit?: number): Promise<Notification[]> {
    const params: Record<string, number> = {};
    if (limit !== undefined) {
      params.limit = limit;
    }
    const response = await axios.get('/api/v1/notifications', { params });
    return response.data.map((item: Record<string, any>) => Notification.fromObject(item));
  }

  /**
   * Mark all notifications for the logged-in user as seen.
   *
   * @returns Promise that resolves when the operation is complete
   */
  async markAllSeen(): Promise<void> {
    await axios.post('/api/v1/notifications/mark-all-seen');
  }
}
