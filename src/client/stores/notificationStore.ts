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

    /**
     * Mark a notification as seen on the server and patch local state so
     * `unreadCount` recomputes. No-op when the row is already seen — the
     * server treats the duplicate flip as a write-skip too.
     */
    async markSeen(id: string): Promise<void> {
      const target = this.notifications.find((n) => n.id === id);
      if (!target || target.seen) {
        return;
      }
      try {
        await notificationService.patchNotification(id, { seen: true });
        target.seen = true;
      }
      catch (error) {
        console.error('Error marking notification as seen:', error);
        throw error;
      }
    },

    /**
     * Dismiss a notification on the server and remove it from the local
     * list so the active inbox reflects the same active-only filter the
     * server applies (pv-d84j.4). On error the row stays put.
     */
    async markDismissed(id: string): Promise<void> {
      const index = this.notifications.findIndex((n) => n.id === id);
      if (index === -1) {
        return;
      }
      try {
        await notificationService.patchNotification(id, { dismissed: true });
        this.notifications.splice(index, 1);
      }
      catch (error) {
        console.error('Error dismissing notification:', error);
        throw error;
      }
    },
  },
});
