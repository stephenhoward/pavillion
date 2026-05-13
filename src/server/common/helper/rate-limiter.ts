/**
 * Shared in-memory sliding-window rate limiter.
 *
 * Process-local sliding-window counter keyed by arbitrary string. The window
 * and cap are configurable per instance via the constructor; the default
 * settings preserve the original ICS-sync contract (1 hour window, 4
 * acquisitions per key) so existing callers do not need to change.
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

/** Default cap: maximum acquisitions allowed per key in the configured window. */
export const SYNC_PER_SOURCE_HOURLY_LIMIT = 4;

/** Default window: milliseconds per hour. */
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Options controlling the limiter's window and cap. Either or both may be
 * omitted to inherit the ICS-sync defaults.
 */
export interface SyncRateLimiterOptions {
  /** Maximum acquisitions allowed per key inside `windowMs`. */
  limit?: number;
  /** Sliding window in milliseconds. */
  windowMs?: number;
}

/**
 * Process-local sliding-window counter keyed by arbitrary string. Entries
 * expire lazily on check.
 *
 * Construct with no arguments for the legacy ICS-sync defaults (4 per hour),
 * or pass an options object to use a different window/cap — for example, the
 * ActivityPub follow-backfill worker uses `{ limit: 60, windowMs: 60_000 }`
 * to enforce a 60 req/min per-source cap.
 */
export class SyncRateLimiter {
  private timestamps: Map<string, number[]> = new Map();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(options: SyncRateLimiterOptions = {}) {
    this.limit = options.limit ?? SYNC_PER_SOURCE_HOURLY_LIMIT;
    this.windowMs = options.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
  }

  /**
   * Records an acquisition attempt. Returns true if the call is allowed.
   */
  tryAcquire(sourceId: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const existing = this.timestamps.get(sourceId) ?? [];
    // Drop stale entries.
    const fresh = existing.filter(t => t > cutoff);
    if (fresh.length >= this.limit) {
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
