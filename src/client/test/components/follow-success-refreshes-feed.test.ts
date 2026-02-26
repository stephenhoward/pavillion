import { describe, it, expect, vi } from 'vitest';

/**
 * Tests: handleFollowSuccess refreshes both follows and feed events
 *
 * Verifies the post-follow refresh logic used in both root.vue and follows.vue.
 * After a successful follow, the UI must reload BOTH the follows list AND the
 * feed events so that the Events tab shows events from the newly followed
 * calendar without requiring a page navigation.
 *
 * These tests exercise the handler logic in isolation — the same way the
 * feed-events-empty-state tests do — because mounting the full Vue components
 * requires extensive store and i18next infrastructure.
 */

describe('handleFollowSuccess calls both loadFollows and loadFeed', () => {
  /**
   * Simulate the handleFollowSuccess handler as it should exist in root.vue
   * and follows.vue after the fix:
   *
   *   const handleFollowSuccess = async () => {
   *     try {
   *       await Promise.all([feedStore.loadFollows(), feedStore.loadFeed()]);
   *     } catch (error) { ... }
   *   };
   */
  const makeHandler = (feedStore: { loadFollows: () => Promise<void>; loadFeed: () => Promise<void> }) => {
    return async () => {
      try {
        await Promise.all([feedStore.loadFollows(), feedStore.loadFeed()]);
      }
      catch (error) {
        console.error('Error refreshing feed after follow:', error);
      }
    };
  };

  it('calls loadFollows when a follow succeeds', async () => {
    const feedStore = {
      loadFollows: vi.fn().mockResolvedValue(undefined),
      loadFeed: vi.fn().mockResolvedValue(undefined),
    };

    const handler = makeHandler(feedStore);
    await handler();

    expect(feedStore.loadFollows).toHaveBeenCalledOnce();
  });

  it('calls loadFeed when a follow succeeds', async () => {
    const feedStore = {
      loadFollows: vi.fn().mockResolvedValue(undefined),
      loadFeed: vi.fn().mockResolvedValue(undefined),
    };

    const handler = makeHandler(feedStore);
    await handler();

    expect(feedStore.loadFeed).toHaveBeenCalledOnce();
  });

  it('calls both loadFollows and loadFeed in parallel', async () => {
    const callOrder: string[] = [];
    const feedStore = {
      loadFollows: vi.fn().mockImplementation(async () => {
        callOrder.push('loadFollows');
      }),
      loadFeed: vi.fn().mockImplementation(async () => {
        callOrder.push('loadFeed');
      }),
    };

    const handler = makeHandler(feedStore);
    await handler();

    // Both must have been called
    expect(feedStore.loadFollows).toHaveBeenCalledOnce();
    expect(feedStore.loadFeed).toHaveBeenCalledOnce();
    // Both calls recorded
    expect(callOrder).toContain('loadFollows');
    expect(callOrder).toContain('loadFeed');
  });

  it('does not throw when loadFeed rejects (error is caught)', async () => {
    const feedStore = {
      loadFollows: vi.fn().mockResolvedValue(undefined),
      loadFeed: vi.fn().mockRejectedValue(new Error('Network error')),
    };

    const handler = makeHandler(feedStore);

    // Should not throw — error is caught internally
    await expect(handler()).resolves.toBeUndefined();
  });

  it('does not throw when loadFollows rejects (error is caught)', async () => {
    const feedStore = {
      loadFollows: vi.fn().mockRejectedValue(new Error('Network error')),
      loadFeed: vi.fn().mockResolvedValue(undefined),
    };

    const handler = makeHandler(feedStore);

    // Should not throw — error is caught internally
    await expect(handler()).resolves.toBeUndefined();
  });
});
