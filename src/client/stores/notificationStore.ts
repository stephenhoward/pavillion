import { defineStore } from 'pinia';
import NotificationService from '@/client/service/notification';
import type { NotificationResponse } from '@/common/model/notification';

/**
 * State interface for the notification store.
 */
interface NotificationState {
  notifications: NotificationResponse[];
  hasMore: boolean;
  isLoading: boolean;
}

const PAGE_SIZE = 50;

/** Shared service instance for all store actions. */
const notificationService = new NotificationService();

/**
 * Pinia store for managing notification state and operations.
 *
 * The store holds the response objects from `GET /api/v1/notification`
 * (per-recipient projections —). It does not
 * own any write-side operations; `markAllSeen` is not part of the
 * current API surface, so the store does not expose it. The inbox
 * reflects unread state via the `seen` boolean on each row.
 */
export const useNotificationStore = defineStore('notifications', {
  state: (): NotificationState => ({
    notifications: [],
    hasMore: false,
    isLoading: false,
  }),

  getters: {
    /**
     * Count of notifications that have not yet been seen.
     */
    unreadCount: (state): number => state.notifications.filter((n) => !n.seen).length,
  },

  actions: {
    /**
     * Fetch the first page of notifications, replacing the current list.
     */
    async fetchNotifications(): Promise<void> {
      this.isLoading = true;
      try {
        const results = await notificationService.getNotifications(PAGE_SIZE, 0);
        this.notifications = results;
        this.hasMore = results.length === PAGE_SIZE;
      }
      catch (error) {
        console.error('Error fetching notifications:', error);
        throw error;
      }
      finally {
        this.isLoading = false;
      }
    },

    /**
     * Fetch the next page of notifications and append to the current list.
     */
    async loadMore(): Promise<void> {
      if (!this.hasMore || this.isLoading) {
        return;
      }
      this.isLoading = true;
      try {
        const results = await notificationService.getNotifications(PAGE_SIZE, this.notifications.length);
        this.notifications = [...this.notifications, ...results];
        this.hasMore = results.length === PAGE_SIZE;
      }
      catch (error) {
        console.error('Error loading more notifications:', error);
        throw error;
      }
      finally {
        this.isLoading = false;
      }
    },
  },
});
