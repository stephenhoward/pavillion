/**
 * Shared in-memory sliding-window rate limiter.
 *
 * Process-local sliding-window counter keyed by arbitrary string. The window
 * is 1 hour; the cap is {@link SYNC_PER_SOURCE_HOURLY_LIMIT}. Entries expire
 * lazily on check.
 *
 * Lives in `src/server/common/helper/` rather than inside any single domain so
 * that multiple domains (ICS import, ActivityPub follow-backfill, ...) can
 * share one implementation without cross-domain imports violating
 * domain-structure standards.
 *
 * An in-memory cap is sufficient for v1 (single-instance deployment is the
 * common case; distributed operators will add Redis-backed limits in a later
 * bead — see complexity-playbook YAGNI).
 */

/** Maximum acquisitions allowed per key in a sliding 1-hour window. */
export const SYNC_PER_SOURCE_HOURLY_LIMIT = 4;

/** Milliseconds per hour — the rate-limit window. */
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Process-local sliding-window counter keyed by arbitrary string. The window
 * is 1 hour; the cap is {@link SYNC_PER_SOURCE_HOURLY_LIMIT}. Entries expire
 * lazily on check.
 */
export class SyncRateLimiter {
  private timestamps: Map<string, number[]> = new Map();

  /**
   * Records an acquisition attempt. Returns true if the call is allowed.
   */
  tryAcquire(sourceId: string, now: number = Date.now()): boolean {
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    const existing = this.timestamps.get(sourceId) ?? [];
    // Drop stale entries.
    const fresh = existing.filter(t => t > cutoff);
    if (fresh.length >= SYNC_PER_SOURCE_HOURLY_LIMIT) {
      this.timestamps.set(sourceId, fresh);
      return false;
    }
    fresh.push(now);
    this.timestamps.set(sourceId, fresh);
    return true;
  }

  /**
   * Clear recorded timestamps. Intended for tests.
   */
  reset(): void {
    this.timestamps.clear();
  }
}
