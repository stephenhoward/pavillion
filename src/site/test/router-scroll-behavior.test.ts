/**
 * Tests for the site router's scroll behavior.
 *
 * Event cards navigate inside the SPA rather than reloading the document, so
 * the router — not the browser — decides where the window lands. These tests
 * pin the rule against the shipped route table: a new view starts at the top
 * (as the old full reload did), back/forward restores the saved position, and
 * a navigation that stays on the same view leaves the scroll alone.
 *
 * Back/forward additionally waits for any scroll hold the destination view
 * registered, so a view that renders its content asynchronously is tall
 * enough for the saved position by the time it is applied.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRouter, createMemoryHistory } from 'vue-router';

import { buildSiteRoutes, siteScrollBehavior } from '@/site/routes';
import { holdScrollUntil, takeScrollHold, SCROLL_HOLD_MAX_WAIT_MS } from '@/site/routing/scroll-hold';

// Distinct stubs per view: the rule compares view identity, so sharing one
// stub across every route would make every navigation look like "same view".
const router = createRouter({
  history: createMemoryHistory(),
  routes: buildSiteRoutes({
    discovery: { template: '<div>discovery</div>' },
    calendar: { template: '<div>calendar</div>' },
    event: { template: '<div>event</div>' },
    instance: { template: '<div>instance</div>' },
    series: { template: '<div>series</div>' },
  }),
});

/**
 * Evaluate the scroll behavior for a navigation between two site paths.
 */
function scrollFor(fromPath: string, toPath: string, savedPosition: { left: number; top: number } | null = null) {
  const from = router.resolve(fromPath);
  const to = router.resolve(toPath);
  return siteScrollBehavior(to, from as any, savedPosition);
}

describe('siteScrollBehavior', () => {
  afterEach(() => {
    // A hold left behind by one case must not delay the next.
    takeScrollHold();
    vi.useRealTimers();
  });

  it('should start at the top when a calendar event card opens an event instance page', () => {
    expect(scrollFor('/mycal', '/mycal/events/evt-1/20260610-1200')).toEqual({ top: 0 });
  });

  it('should start at the top for a locale-prefixed calendar-to-instance navigation', () => {
    expect(scrollFor('/es/mycal', '/es/mycal/events/evt-1/20260610-1200')).toEqual({ top: 0 });
  });

  it('should start at the top when discovery opens a calendar', () => {
    expect(scrollFor('/discover', '/mycal')).toEqual({ top: 0 });
  });

  it('should restore the saved position on back/forward', async () => {
    const saved = { left: 0, top: 840 };
    expect(await scrollFor('/mycal/events/evt-1/20260610-1200', '/mycal', saved)).toEqual(saved);
  });

  it('should not restore the saved position until the destination view releases its hold', async () => {
    let release!: () => void;
    holdScrollUntil(new Promise<void>((resolve) => { release = resolve; }));

    const saved = { left: 0, top: 294 };
    let restored: unknown = null;
    const pending = Promise.resolve(scrollFor('/mycal', '/discover', saved)).then((position) => {
      restored = position;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(restored).toBeNull();

    release();
    await pending;
    expect(restored).toEqual(saved);
  });

  it('should still restore the saved position when the hold rejects', async () => {
    holdScrollUntil(Promise.reject(new Error('list request failed')));

    const saved = { left: 0, top: 294 };
    expect(await scrollFor('/mycal', '/discover', saved)).toEqual(saved);
  });

  it('should restore the saved position once the hold cap elapses on a hung view', async () => {
    vi.useFakeTimers();
    holdScrollUntil(new Promise<void>(() => {}));

    const saved = { left: 0, top: 294 };
    let restored: unknown = null;
    const pending = Promise.resolve(scrollFor('/mycal', '/discover', saved)).then((position) => {
      restored = position;
    });

    await vi.advanceTimersByTimeAsync(SCROLL_HOLD_MAX_WAIT_MS - 1);
    expect(restored).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(restored).toEqual(saved);
  });

  it('should consume the hold so a later back/forward does not wait on it', async () => {
    holdScrollUntil(new Promise<void>(() => {}));
    // A forward navigation to the holding view takes the hold without waiting on it.
    expect(scrollFor('/mycal', '/discover')).toEqual({ top: 0 });

    const saved = { left: 0, top: 840 };
    expect(await scrollFor('/mycal/events/evt-1/20260610-1200', '/mycal', saved)).toEqual(saved);
  });

  it('should leave scroll alone when only the query changes on the same view', () => {
    expect(scrollFor('/mycal?categories=abc', '/mycal')).toBe(false);
  });

  it('should leave scroll alone when a locale switch keeps the same view', () => {
    expect(scrollFor('/mycal', '/es/mycal')).toBe(false);
  });
});
