import { Request, Response, NextFunction, RequestHandler } from 'express';
import config from 'config';

/**
 * Rate limit entry tracking request count and window expiration
 */
interface RateLimitEntry {
  count: number;
  windowStart: number;
}

/**
 * Generic in-memory store for rate limiting with LRU eviction.
 * Can be used for any string-based key (actor ID, calendar name, IP address, etc.)
 */
class RateLimitStore<TKey extends string = string> {
  private store: Map<TKey, RateLimitEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private maxSize: number;

  constructor(private windowMs: number, maxSize: number = 10000) {
    this.maxSize = maxSize;
    // Start periodic cleanup every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Check if a key has exceeded the rate limit and increment counter
   *
   * @param key - The identifier to rate limit (actor URI, calendar name, etc.)
   * @param maxRequests - Maximum requests allowed in the window
   * @returns Object with allowed status and current count
   */
  check(key: TKey, maxRequests: number): { allowed: boolean; count: number } {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now - entry.windowStart >= this.windowMs) {
      // New window or expired window - reset
      // Delete first if it exists to update LRU order
      if (this.store.has(key)) {
        this.store.delete(key);
      }
      this.store.set(key, { count: 1, windowStart: now });

      // Evict oldest entries if we exceeded max size
      if (this.store.size > this.maxSize) {
        this.evictOldest();
      }

      return { allowed: true, count: 1 };
    }

    // Increment counter - delete and re-add for LRU
    this.store.delete(key);
    entry.count++;
    this.store.set(key, entry);

    if (entry.count > maxRequests) {
      return { allowed: false, count: entry.count };
    }

    return { allowed: true, count: entry.count };
  }

  /**
   * Get the remaining time in the current window for a key
   *
   * @param key - The identifier being rate limited
   * @returns Remaining time in milliseconds, or 0 if no entry exists
   */
  getRetryAfter(key: TKey): number {
    const entry = this.store.get(key);
    if (!entry) {
      return 0;
    }

    const elapsed = Date.now() - entry.windowStart;
    const remaining = this.windowMs - elapsed;
    return Math.max(0, remaining);
  }

  /**
   * Remove expired entries from the store
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now - entry.windowStart >= this.windowMs) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Stop the cleanup interval (for testing cleanup)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Clear all entries (for testing)
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get the current size of the store (for testing)
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * Evict the oldest (least recently used) entries to maintain max size.
   * Map keys are in insertion order, so the first keys are the oldest.
   */
  private evictOldest(): void {
    const entriesToRemove = this.store.size - this.maxSize;
    if (entriesToRemove <= 0) {
      return;
    }

    const keysToRemove: TKey[] = [];
    let count = 0;
    for (const key of this.store.keys()) {
      if (count >= entriesToRemove) {
        break;
      }
      keysToRemove.push(key);
      count++;
    }

    for (const key of keysToRemove) {
      this.store.delete(key);
    }
  }
}

/**
 * Type alias for actor-based rate limiting
 */
type ActorRateLimitStore = RateLimitStore<string>;

/**
 * Type alias for calendar-based rate limiting
 */
type CalendarRateLimitStore = RateLimitStore<string>;

/**
 * Get ActivityPub actor rate limit configuration
 */
function getActorRateLimitConfig() {
  return {
    max: config.get<number>('rateLimit.activitypub.actor.max'),
    windowMs: config.get<number>('rateLimit.activitypub.actor.windowMs'),
  };
}

/**
 * Get ActivityPub calendar rate limit configuration
 */
function getCalendarRateLimitConfig() {
  return {
    max: config.get<number>('rateLimit.activitypub.calendar.max'),
    windowMs: config.get<number>('rateLimit.activitypub.calendar.windowMs'),
  };
}

// Shared store instances
let sharedActorStore: ActorRateLimitStore | null = null;
let sharedCalendarStore: CalendarRateLimitStore | null = null;

/**
 * Gets or creates the shared actor rate limit store
 *
 * @param windowMs - Time window in milliseconds
 * @returns The shared store instance
 */
function getActorStore(windowMs: number): ActorRateLimitStore {
  if (!sharedActorStore) {
    sharedActorStore = new RateLimitStore<string>(windowMs);
  }
  return sharedActorStore;
}

/**
 * Gets or creates the shared calendar rate limit store
 *
 * @param windowMs - Time window in milliseconds
 * @returns The shared store instance
 */
function getCalendarStore(windowMs: number): CalendarRateLimitStore {
  if (!sharedCalendarStore) {
    sharedCalendarStore = new RateLimitStore<string>(windowMs);
  }
  return sharedCalendarStore;
}

/**
 * Extracts the actor identifier from an ActivityPub request.
 * The actor can be in the request body as a string or object with 'id' property.
 *
 * @param req - Express request object
 * @returns The actor identifier string or null if not found
 */
function extractActorFromRequest(req: Request): string | null {
  const body = req.body;

  if (!body) {
    return null;
  }

  // Actor can be a string (URI) or an object with 'id' property
  if (typeof body.actor === 'string') {
    return body.actor;
  }

  if (body.actor && typeof body.actor === 'object' && typeof body.actor.id === 'string') {
    return body.actor.id;
  }

  return null;
}

/**
 * Extracts the calendar URL name from the request parameters.
 *
 * @param req - Express request object
 * @returns The calendar URL name or null if not found
 */
function extractCalendarFromRequest(req: Request): string | null {
  // Route parameter is :urlname (lowercase) in server.ts
  const urlName = req.params?.urlname;

  if (typeof urlName === 'string' && urlName.length > 0) {
    return urlName;
  }

  return null;
}

/**
 * Creates an Express middleware for per-actor rate limiting on ActivityPub inbox endpoints.
 *
 * This middleware limits the number of requests from each unique actor (identified by
 * their ActivityPub actor URI) within a sliding time window.
 *
 * Default values are loaded from config (rateLimit.activitypub.actor.*). The global
 * rateLimit.enabled flag should be checked before installing this middleware on routes.
 *
 * @param maxRequests - Maximum number of requests allowed per actor in the time window (default from config)
 * @param windowMs - Time window in milliseconds (default from config)
 * @returns Express middleware function that enforces rate limiting
 *
 * @example
 * // Use defaults from config
 * router.post('/inbox', createActorRateLimiter(), inboxHandler);
 *
 * @example
 * // Custom limits: 30 requests per 30 seconds
 * router.post('/inbox', createActorRateLimiter(30, 30000), inboxHandler);
 */
export function createActorRateLimiter(
  maxRequests?: number,
  windowMs?: number,
): RequestHandler {
  const actorConfig = getActorRateLimitConfig();
  const finalMaxRequests = maxRequests ?? actorConfig.max;
  const finalWindowMs = windowMs ?? actorConfig.windowMs;
  const store = getActorStore(finalWindowMs);

  return (req: Request, res: Response, next: NextFunction) => {
    const actorId = extractActorFromRequest(req);

    // If no actor can be identified, allow the request but log a warning
    // The downstream handler should validate the request anyway
    if (!actorId) {
      console.warn('[RateLimit] Could not extract actor from request, allowing request');
      return next();
    }

    const result = store.check(actorId, finalMaxRequests);

    if (!result.allowed) {
      const retryAfterMs = store.getRetryAfter(actorId);
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

      console.warn(
        `[RateLimit] Rate limit exceeded for actor ${actorId} (${result.count}/${finalMaxRequests} requests)`,
      );

      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: 'Too many requests from this actor, please try again later.',
        retryAfter: retryAfterSeconds,
      });
      return;
    }

    next();
  };
}

/**
 * Creates an Express middleware for per-calendar rate limiting on ActivityPub inbox endpoints.
 *
 * This middleware limits the total number of requests to each calendar's inbox endpoint
 * within a sliding time window, regardless of which actor is making the request.
 *
 * Default values are loaded from config (rateLimit.activitypub.calendar.*). The global
 * rateLimit.enabled flag should be checked before installing this middleware on routes.
 *
 * @param maxRequests - Maximum number of requests allowed per calendar in the time window (default from config)
 * @param windowMs - Time window in milliseconds (default from config)
 * @returns Express middleware function that enforces rate limiting
 *
 * @example
 * // Use defaults from config
 * router.post('/calendars/:urlName/inbox', createCalendarRateLimiter(), inboxHandler);
 *
 * @example
 * // Custom limits: 60 requests per 30 seconds
 * router.post('/calendars/:urlName/inbox', createCalendarRateLimiter(60, 30000), inboxHandler);
 */
export function createCalendarRateLimiter(
  maxRequests?: number,
  windowMs?: number,
): RequestHandler {
  const calendarConfig = getCalendarRateLimitConfig();
  const finalMaxRequests = maxRequests ?? calendarConfig.max;
  const finalWindowMs = windowMs ?? calendarConfig.windowMs;
  const store = getCalendarStore(finalWindowMs);

  return (req: Request, res: Response, next: NextFunction) => {
    const calendarUrlName = extractCalendarFromRequest(req);

    // If no calendar can be identified, allow the request but log a warning
    // The downstream handler should validate the request anyway
    if (!calendarUrlName) {
      console.warn('[RateLimit] Could not extract calendar from request, allowing request');
      return next();
    }

    const result = store.check(calendarUrlName, finalMaxRequests);

    if (!result.allowed) {
      const retryAfterMs = store.getRetryAfter(calendarUrlName);
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

      console.warn(
        `[RateLimit] Rate limit exceeded for calendar ${calendarUrlName} (${result.count}/${finalMaxRequests} requests)`,
      );

      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: 'Too many requests to this calendar, please try again later.',
        retryAfter: retryAfterSeconds,
      });
      return;
    }

    next();
  };
}

/**
 * Resets the actor rate limit store. Useful for testing.
 */
export function resetActorRateLimitStore(): void {
  if (sharedActorStore) {
    sharedActorStore.destroy();
    sharedActorStore = null;
  }
}

/**
 * Resets the calendar rate limit store. Useful for testing.
 */
export function resetCalendarRateLimitStore(): void {
  if (sharedCalendarStore) {
    sharedCalendarStore.destroy();
    sharedCalendarStore = null;
  }
}

/**
 * Gets the current actor store for testing purposes.
 * Creates a new store if one doesn't exist.
 *
 * @param windowMs - Time window in milliseconds (default from config)
 * @returns The store instance
 */
export function getActorRateLimitStore(windowMs?: number): ActorRateLimitStore {
  const actorConfig = getActorRateLimitConfig();
  const finalWindowMs = windowMs ?? actorConfig.windowMs;
  return getActorStore(finalWindowMs);
}

/**
 * Gets the current calendar store for testing purposes.
 * Creates a new store if one doesn't exist.
 *
 * @param windowMs - Time window in milliseconds (default from config)
 * @returns The store instance
 */
export function getCalendarRateLimitStore(windowMs?: number): CalendarRateLimitStore {
  const calendarConfig = getCalendarRateLimitConfig();
  const finalWindowMs = windowMs ?? calendarConfig.windowMs;
  return getCalendarStore(finalWindowMs);
}
