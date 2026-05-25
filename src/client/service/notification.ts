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

  /**
   * Patch the recipient-side lifecycle state of a notification owned by
   * the logged-in user. Sends only the supplied flags; the server applies
   * timestamp flips and treats no-op cases as a write-skip.
   *
   * Returns void — the server response carries a small `{ ok: true }`
   * acknowledgement; the store performs an optimistic local-state patch
   * and does not re-fetch after a successful PATCH.
   *
   * @param id - The recipient row id (NOT the activity id).
   * @param patch - `{ seen?, dismissed? }`. At least one flag is required.
   */
  async patchNotification(
    id: string,
    patch: { seen?: boolean; dismissed?: boolean },
  ): Promise<void> {
    await axios.patch(`/api/v1/notification/${id}`, patch);
  }
}
