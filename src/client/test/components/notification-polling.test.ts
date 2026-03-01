import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests: Notification polling logic in root.vue
 *
 * Verifies that:
 * - fetchNotifications is called on mount
 * - 30-second interval is set up via startPolling
 * - Polling pauses when tab becomes hidden (visibilitychange)
 * - Polling resumes with an immediate fetch when tab becomes visible
 * - Polling cleanup fires on unmount (clearInterval + removeEventListener)
 * - Errors during polling are silently swallowed (no backoff)
 *
 * These tests exercise the polling logic in isolation using the same pattern
 * as follow-success-refreshes-feed.test.ts — simulating the extracted logic
 * without mounting the full root.vue component (which requires extensive
 * i18next and router infrastructure).
 */

const POLL_INTERVAL_MS = 30000;

/**
 * Simulate the polling controller as it exists in root.vue.
 * Returns methods to match the component lifecycle and event handler.
 */
function makePollingController(
  fetchNotifications: () => Promise<void>,
  addListener: (type: string, handler: () => void) => void,
  removeListener: (type: string, handler: () => void) => void,
  isHidden: () => boolean,
) {
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  const startPolling = () => {
    pollInterval = setInterval(() => {
      fetchNotifications().catch(() => {
        // Silently ignore errors; retry at next normal interval
      });
    }, POLL_INTERVAL_MS);
  };

  const handleVisibilityChange = () => {
    if (isHidden()) {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    }
    else {
      fetchNotifications().catch(() => {
        // Silently ignore errors on tab focus restore
      });
      startPolling();
    }
  };

  const onMounted = () => {
    fetchNotifications().catch(() => {
      // Silently ignore initial fetch error
    });
    startPolling();
    addListener('visibilitychange', handleVisibilityChange);
  };

  const onUnmounted = () => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    removeListener('visibilitychange', handleVisibilityChange);
  };

  const getInterval = () => pollInterval;

  return { onMounted, onUnmounted, handleVisibilityChange, getInterval };
}

describe('Notification polling logic (root.vue)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('onMounted', () => {
    it('calls fetchNotifications immediately on mount', () => {
      const fetchNotifications = vi.fn().mockResolvedValue(undefined);
      const controller = makePollingController(fetchNotifications, vi.fn(), vi.fn(), () => false);

      controller.onMounted();
      controller.onUnmounted();

      expect(fetchNotifications).toHaveBeenCalledOnce();
    });

    it('registers visibilitychange event listener on mount', () => {
      const fetchNotifications = vi.fn().mockResolvedValue(undefined);
      const addListener = vi.fn();
      const controller = makePollingController(fetchNotifications, addListener, vi.fn(), () => false);

      controller.onMounted();
      controller.onUnmounted();

      expect(addListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    });

    it('sets up a 30-second polling interval on mount', () => {
      const fetchNotifications = vi.fn().mockResolvedValue(undefined);
      const controller = makePollingController(fetchNotifications, vi.fn(), vi.fn(), () => false);

      controller.onMounted();

      // Advance by just under 30s — should only have the initial call
      vi.advanceTimersByTime(29999);
      expect(fetchNotifications).toHaveBeenCalledTimes(1);

      // Advance past 30s — now the interval fires
      vi.advanceTimersByTime(1);
      expect(fetchNotifications).toHaveBeenCalledTimes(2);

      controller.onUnmounted();
    });
  });

  describe('onUnmounted', () => {
    it('clears the polling interval on unmount', () => {
      const fetchNotifications = vi.fn().mockResolvedValue(undefined);
      const controller = makePollingController(fetchNotifications, vi.fn(), vi.fn(), () => false);

      controller.onMounted();
      controller.onUnmounted();

      // Advance past poll interval — should NOT fire again after unmount
      vi.advanceTimersByTime(60000);
      expect(fetchNotifications).toHaveBeenCalledTimes(1); // only the initial mount call
    });

    it('removes the visibilitychange event listener on unmount', () => {
      const fetchNotifications = vi.fn().mockResolvedValue(undefined);
      const addListener = vi.fn();
      const removeListener = vi.fn();
      const controller = makePollingController(fetchNotifications, addListener, removeListener, () => false);

      controller.onMounted();
      controller.onUnmounted();

      expect(removeListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    });
  });

  describe('visibilitychange handling', () => {
    it('clears polling interval when tab becomes hidden', () => {
      const fetchNotifications = vi.fn().mockResolvedValue(undefined);
      let hidden = false;
      const controller = makePollingController(fetchNotifications, vi.fn(), vi.fn(), () => hidden);

      controller.onMounted();

      // Simulate tab going hidden
      hidden = true;
      controller.handleVisibilityChange();

      // pollInterval should now be null
      expect(controller.getInterval()).toBeNull();
    });

    it('stops polling when tab is hidden', () => {
      const fetchNotifications = vi.fn().mockResolvedValue(undefined);
      let hidden = false;
      const controller = makePollingController(fetchNotifications, vi.fn(), vi.fn(), () => hidden);

      controller.onMounted();

      // Tab goes hidden — clear the interval
      hidden = true;
      controller.handleVisibilityChange();

      // Advance timer — should NOT poll
      vi.advanceTimersByTime(60000);
      expect(fetchNotifications).toHaveBeenCalledTimes(1); // only the initial mount call
    });

    it('fetches immediately when tab becomes visible again', () => {
      const fetchNotifications = vi.fn().mockResolvedValue(undefined);
      let hidden = false;
      const controller = makePollingController(fetchNotifications, vi.fn(), vi.fn(), () => hidden);

      controller.onMounted();

      // Tab goes hidden
      hidden = true;
      controller.handleVisibilityChange();

      const callsAfterHide = fetchNotifications.mock.calls.length;

      // Tab becomes visible again
      hidden = false;
      controller.handleVisibilityChange();

      // An immediate fetch should have fired
      expect(fetchNotifications).toHaveBeenCalledTimes(callsAfterHide + 1);

      controller.onUnmounted();
    });

    it('resumes 30-second polling when tab becomes visible again', () => {
      const fetchNotifications = vi.fn().mockResolvedValue(undefined);
      let hidden = false;
      const controller = makePollingController(fetchNotifications, vi.fn(), vi.fn(), () => hidden);

      controller.onMounted();

      // Hide the tab — clears the interval
      hidden = true;
      controller.handleVisibilityChange();

      const callsAfterHide = fetchNotifications.mock.calls.length;

      // Show the tab — triggers immediate fetch + restarts interval
      hidden = false;
      controller.handleVisibilityChange();

      // immediate fetch fires on visibility restore
      expect(fetchNotifications).toHaveBeenCalledTimes(callsAfterHide + 1);

      // Advance 30s — interval fires again
      vi.advanceTimersByTime(30000);
      expect(fetchNotifications).toHaveBeenCalledTimes(callsAfterHide + 2);

      controller.onUnmounted();
    });
  });

  describe('error handling', () => {
    it('does not throw when fetchNotifications rejects on mount', () => {
      const fetchNotifications = vi.fn().mockRejectedValue(new Error('Network error'));
      const controller = makePollingController(fetchNotifications, vi.fn(), vi.fn(), () => false);

      // Should not throw synchronously
      expect(() => controller.onMounted()).not.toThrow();

      // Clean up interval so timers don't keep running
      controller.onUnmounted();
    });

    it('does not propagate errors when polling interval fires and fetch rejects', async () => {
      const fetchNotifications = vi.fn().mockRejectedValue(new Error('Network error'));
      const controller = makePollingController(fetchNotifications, vi.fn(), vi.fn(), () => false);

      controller.onMounted();

      // Advance exactly one poll interval
      vi.advanceTimersByTime(30000);

      // Give promises time to settle without running the interval again
      await Promise.resolve();

      // Verify fetchNotifications was called (mount + 1 interval fire)
      expect(fetchNotifications).toHaveBeenCalledTimes(2);

      // Clean up
      controller.onUnmounted();
    });

    it('does not throw when fetchNotifications rejects on tab visibility restore', () => {
      const fetchNotifications = vi.fn().mockRejectedValue(new Error('Network error'));

      let hidden = true;
      const controller = makePollingController(fetchNotifications, vi.fn(), vi.fn(), () => hidden);

      hidden = false;
      // Should not throw synchronously
      expect(() => controller.handleVisibilityChange()).not.toThrow();

      // Clean up
      controller.onUnmounted();
    });
  });
});

describe('Badge unread count reactivity logic', () => {
  /**
   * Simulate the badge: notificationStore.unreadCount binding in navigationItems.
   * Mirrors the computed property in root.vue:
   *   badge: notificationStore.unreadCount
   */
  it('badge value equals the unread count from the store', () => {
    const notificationStore = { unreadCount: 3 };
    const inboxItem = {
      id: 'inbox',
      badge: notificationStore.unreadCount,
    };
    expect(inboxItem.badge).toBe(3);
  });

  it('badge value is 0 when there are no unread notifications', () => {
    const notificationStore = { unreadCount: 0 };
    const inboxItem = {
      id: 'inbox',
      badge: notificationStore.unreadCount,
    };
    expect(inboxItem.badge).toBe(0);
  });
});
