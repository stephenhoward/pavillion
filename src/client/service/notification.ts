import axios from 'axios';

import { type NotificationResponse } from '@/common/model/notification';

/**
 * Client service for notification API endpoints.
 */
export default class NotificationService {

  /**
   * Fetch notifications for the logged-in user.
   *
   * @param limit - Maximum number of notifications to return (default 50, max 100)
   * @param offset - Number of notifications to skip (default 0)
   * @returns Promise resolving to an array of `NotificationResponse`.
   */
  async getNotifications(limit?: number, offset?: number): Promise<NotificationResponse[]> {
    const params: Record<string, number> = {};
    if (limit !== undefined) {
      params.limit = limit;
    }
    if (offset !== undefined) {
      params.offset = offset;
    }
    const response = await axios.get('/api/v1/notification', { params });
    return response.data as NotificationResponse[];
  }
}
