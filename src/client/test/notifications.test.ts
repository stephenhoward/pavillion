import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useNotificationStore } from '@/client/stores/notificationStore';
import { Notification } from '@/common/model/notification';

// Use vi.hoisted() so the mock object is available when vi.mock() factory runs
const { mockNotificationService } = vi.hoisted(() => ({
  mockNotificationService: {
    getNotifications: vi.fn(),
    markAllSeen: vi.fn(),
  },
}));

// Mock the NotificationService module so the store uses the mock
vi.mock('@/client/service/notification', async () => {
  const actual = await vi.importActual('@/client/service/notification');
  return {
    ...actual,
    default: vi.fn(() => mockNotificationService),
  };
});

function makeNotification(overrides: Partial<Record<string, any>> = {}): Notification {
  return Notification.fromObject({
    id: 'notif-1',
    type: 'follow',
    calendarId: 'cal-1',
    eventId: null,
    actorName: 'Alice',
    actorUrl: 'https://example.com/alice',
    seen: false,
    createdAt: '2026-02-28T00:00:00.000Z',
    ...overrides,
  });
}

describe('NotificationStore', () => {
  let store: ReturnType<typeof useNotificationStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useNotificationStore();
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('starts with empty notifications array', () => {
      expect(store.notifications).toEqual([]);
    });

    it('starts with hasMore false', () => {
      expect(store.hasMore).toBe(false);
    });

    it('starts with isLoading false', () => {
      expect(store.isLoading).toBe(false);
    });

    it('starts with unreadCount of 0', () => {
      expect(store.unreadCount).toBe(0);
    });
  });

  describe('unreadCount getter', () => {
    it('counts only notifications where seen === false', () => {
      store.notifications = [
        makeNotification({ id: 'notif-1', seen: false }),
        makeNotification({ id: 'notif-2', seen: true }),
        makeNotification({ id: 'notif-3', seen: false }),
      ];

      expect(store.unreadCount).toBe(2);
    });

    it('returns 0 when all notifications are seen', () => {
      store.notifications = [
        makeNotification({ id: 'notif-1', seen: true }),
        makeNotification({ id: 'notif-2', seen: true }),
      ];

      expect(store.unreadCount).toBe(0);
    });

    it('returns correct count when all notifications are unseen', () => {
      store.notifications = [
        makeNotification({ id: 'notif-1', seen: false }),
        makeNotification({ id: 'notif-2', seen: false }),
        makeNotification({ id: 'notif-3', seen: false }),
      ];

      expect(store.unreadCount).toBe(3);
    });
  });

  describe('fetchNotifications action', () => {
    it('replaces notifications with fetched results', async () => {
      const fetched = [
        makeNotification({ id: 'notif-1', seen: false }),
        makeNotification({ id: 'notif-2', seen: true }),
      ];
      mockNotificationService.getNotifications.mockResolvedValue(fetched);

      await store.fetchNotifications();

      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(50, 0);
      expect(store.notifications).toEqual(fetched);
    });

    it('sets hasMore to true when a full page is returned', async () => {
      const PAGE_SIZE = 50;
      const fetched = Array.from({ length: PAGE_SIZE }, (_, i) =>
        makeNotification({ id: `notif-${i}`, seen: false }),
      );
      mockNotificationService.getNotifications.mockResolvedValue(fetched);

      await store.fetchNotifications();

      expect(store.hasMore).toBe(true);
    });

    it('sets hasMore to false when fewer than a full page is returned', async () => {
      const fetched = [makeNotification({ id: 'notif-1', seen: false })];
      mockNotificationService.getNotifications.mockResolvedValue(fetched);

      await store.fetchNotifications();

      expect(store.hasMore).toBe(false);
    });

    it('sets isLoading to false after success', async () => {
      mockNotificationService.getNotifications.mockResolvedValue([]);

      await store.fetchNotifications();

      expect(store.isLoading).toBe(false);
    });

    it('sets isLoading to false after error and rethrows', async () => {
      mockNotificationService.getNotifications.mockRejectedValue(new Error('API error'));

      await expect(store.fetchNotifications()).rejects.toThrow('API error');

      expect(store.isLoading).toBe(false);
    });
  });

  describe('loadMore action', () => {
    it('appends results to existing notifications', async () => {
      const existing = [makeNotification({ id: 'notif-1', seen: true })];
      store.notifications = existing;
      store.hasMore = true;

      const newItems = [makeNotification({ id: 'notif-2', seen: false })];
      mockNotificationService.getNotifications.mockResolvedValue(newItems);

      await store.loadMore();

      expect(store.notifications).toHaveLength(2);
      expect(store.notifications[0].id).toBe('notif-1');
      expect(store.notifications[1].id).toBe('notif-2');
    });

    it('passes offset equal to current notifications length', async () => {
      const PAGE_SIZE = 50;
      const existing = Array.from({ length: PAGE_SIZE }, (_, i) =>
        makeNotification({ id: `notif-${i}`, seen: false }),
      );
      store.notifications = existing;
      store.hasMore = true;

      mockNotificationService.getNotifications.mockResolvedValue([]);

      await store.loadMore();

      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(PAGE_SIZE, PAGE_SIZE);
    });

    it('passes correct offset after two loadMore calls', async () => {
      const PAGE_SIZE = 50;
      const firstPage = Array.from({ length: PAGE_SIZE }, (_, i) =>
        makeNotification({ id: `notif-${i}`, seen: false }),
      );
      store.notifications = firstPage;
      store.hasMore = true;

      const secondPage = Array.from({ length: PAGE_SIZE }, (_, i) =>
        makeNotification({ id: `notif-${PAGE_SIZE + i}`, seen: false }),
      );
      mockNotificationService.getNotifications.mockResolvedValue(secondPage);

      await store.loadMore();

      expect(mockNotificationService.getNotifications).toHaveBeenNthCalledWith(1, PAGE_SIZE, PAGE_SIZE);

      // After first loadMore, notifications.length is now 2 * PAGE_SIZE
      const thirdPage: Notification[] = [];
      mockNotificationService.getNotifications.mockResolvedValue(thirdPage);

      await store.loadMore();

      expect(mockNotificationService.getNotifications).toHaveBeenNthCalledWith(2, PAGE_SIZE, 2 * PAGE_SIZE);
    });

    it('does nothing when hasMore is false', async () => {
      store.hasMore = false;

      await store.loadMore();

      expect(mockNotificationService.getNotifications).not.toHaveBeenCalled();
    });

    it('does nothing when isLoading is true', async () => {
      store.hasMore = true;
      store.isLoading = true;

      await store.loadMore();

      expect(mockNotificationService.getNotifications).not.toHaveBeenCalled();
    });

    it('sets isLoading to false after load', async () => {
      store.hasMore = true;
      mockNotificationService.getNotifications.mockResolvedValue([]);

      await store.loadMore();

      expect(store.isLoading).toBe(false);
    });
  });

  describe('markAllSeen action', () => {
    it('calls service markAllSeen', async () => {
      mockNotificationService.markAllSeen.mockResolvedValue(undefined);

      await store.markAllSeen();

      expect(mockNotificationService.markAllSeen).toHaveBeenCalled();
    });

    it('sets all local notifications to seen=true', async () => {
      store.notifications = [
        makeNotification({ id: 'notif-1', seen: false }),
        makeNotification({ id: 'notif-2', seen: false }),
        makeNotification({ id: 'notif-3', seen: true }),
      ];
      mockNotificationService.markAllSeen.mockResolvedValue(undefined);

      await store.markAllSeen();

      expect(store.notifications.every((n) => n.seen)).toBe(true);
    });

    it('updates unreadCount to 0 after markAllSeen', async () => {
      store.notifications = [
        makeNotification({ id: 'notif-1', seen: false }),
        makeNotification({ id: 'notif-2', seen: false }),
      ];
      mockNotificationService.markAllSeen.mockResolvedValue(undefined);

      await store.markAllSeen();

      expect(store.unreadCount).toBe(0);
    });
  });
});
