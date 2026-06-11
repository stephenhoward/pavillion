import { Request, Response, NextFunction, RequestHandler } from 'express';
import config from 'config';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('activitypub');

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
 * Type alias for user-based rate limiting
 */
type UserRateLimitStore = RateLimitStore<string>;

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

/**
 * Get ActivityPub user rate limit configuration
 */
function getUserRateLimitConfig() {
  return {
    max: config.get<number>('rateLimit.activitypub.user.max'),
    windowMs: config.get<number>('rateLimit.activitypub.user.windowMs'),
  };
}

// Shared store instances
let sharedActorStore: ActorRateLimitStore | null = null;
let sharedCalendarStore: CalendarRateLimitStore | null = null;
let sharedUserStore: UserRateLimitStore | null = null;

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
 * Gets or creates the shared user rate limit store
 *
 * @param windowMs - Time window in milliseconds
 * @returns The shared store instance
 */
function getUserStore(windowMs: number): UserRateLimitStore {
  if (!sharedUserStore) {
    sharedUserStore = new RateLimitStore<string>(windowMs);
  }
  return sharedUserStore;
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
 * Extracts the username from the request parameters.
 *
 * @param req - Express request object
 * @returns The username or null if not found
 */
function extractUserFromRequest(req: Request): string | null {
  // Route parameter is :username in user-actor.ts
  const username = req.params?.username;

  if (typeof username === 'string' && username.length > 0) {
    return username;
  }

  return null;
}

/**
 * Marker property attached to every ActivityPub rate-limit middleware returned by the
 * factories below. The common express-rate-limit limiters are self-identifying (they
 * expose `getKey`/`resetKey` methods), but these AP limiters are plain closures over an
 * in-memory LRU store and carry no such signature. The rate-limit coverage guard test
 * (`src/server/common/test/rate-limit-coverage.test.ts`) walks the real router stack and
 * uses this marker to recognize AP inbox limiters by presence rather than by fragile
 * function-name matching. The property is non-enumerable so it never leaks into
 * serialization or middleware introspection elsewhere.
 */
export const AP_RATE_LIMITER_MARKER = '__pavillionApRateLimiter';

/**
 * Tags a middleware closure as an ActivityPub rate limiter so the coverage guard test can
 * detect it by presence. Returns the same function for fluent use in the factories.
 */
function markAsApRateLimiter(handler: RequestHandler): RequestHandler {
  Object.defineProperty(handler, AP_RATE_LIMITER_MARKER, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return handler;
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

  return markAsApRateLimiter((req: Request, res: Response, next: NextFunction) => {
    const actorId = extractActorFromRequest(req);

    // If no actor can be identified, allow the request but log a warning
    // The downstream handler should validate the request anyway
    if (!actorId) {
      logger.warn('Could not extract actor from request, allowing request');
      return next();
    }

    const result = store.check(actorId, finalMaxRequests);

    if (!result.allowed) {
      const retryAfterMs = store.getRetryAfter(actorId);
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

      logger.warn({ actorId, count: result.count, max: finalMaxRequests }, 'Rate limit exceeded for actor');

      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: 'Too many requests from this actor, please try again later.',
        retryAfter: retryAfterSeconds,
      });
      return;
    }

    next();
  });
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

  return markAsApRateLimiter((req: Request, res: Response, next: NextFunction) => {
    const calendarUrlName = extractCalendarFromRequest(req);

    // If no calendar can be identified, allow the request but log a warning
    // The downstream handler should validate the request anyway
    if (!calendarUrlName) {
      logger.warn('Could not extract calendar from request, allowing request');
      return next();
    }

    const result = store.check(calendarUrlName, finalMaxRequests);

    if (!result.allowed) {
      const retryAfterMs = store.getRetryAfter(calendarUrlName);
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

      logger.warn({ calendarUrlName, count: result.count, max: finalMaxRequests }, 'Rate limit exceeded for calendar');

      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: 'Too many requests to this calendar, please try again later.',
        retryAfter: retryAfterSeconds,
      });
      return;
    }

    next();
  });
}

/**
 * Creates an Express middleware for per-user rate limiting on the user (Person)
 * ActivityPub inbox endpoint.
 *
 * This middleware limits the total number of requests to each user's inbox endpoint
 * within a sliding time window, keyed on the username path parameter, regardless of
 * which actor is making the request.
 *
 * Default values are loaded from config (rateLimit.activitypub.user.*). The global
 * rateLimit.enabled flag should be checked before installing this middleware on routes.
 *
 * @param maxRequests - Maximum number of requests allowed per user in the time window (default from config)
 * @param windowMs - Time window in milliseconds (default from config)
 * @returns Express middleware function that enforces rate limiting
 *
 * @example
 * // Use defaults from config
 * router.post('/users/:username/inbox', createUserRateLimiter(), inboxHandler);
 *
 * @example
 * // Custom limits: 60 requests per 30 seconds
 * router.post('/users/:username/inbox', createUserRateLimiter(60, 30000), inboxHandler);
 */
export function createUserRateLimiter(
  maxRequests?: number,
  windowMs?: number,
): RequestHandler {
  const userConfig = getUserRateLimitConfig();
  const finalMaxRequests = maxRequests ?? userConfig.max;
  const finalWindowMs = windowMs ?? userConfig.windowMs;
  const store = getUserStore(finalWindowMs);

  return markAsApRateLimiter((req: Request, res: Response, next: NextFunction) => {
    const username = extractUserFromRequest(req);

    // If no user can be identified, allow the request but log a warning
    // The downstream handler should validate the request anyway
    if (!username) {
      logger.warn('Could not extract user from request, allowing request');
      return next();
    }

    const result = store.check(username, finalMaxRequests);

    if (!result.allowed) {
      const retryAfterMs = store.getRetryAfter(username);
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

      // DEC-004: do not log the local-account username (it is account-identifying PII).
      // count/max are sufficient for ops diagnostics without tying the event to a named account.
      logger.warn({ count: result.count, max: finalMaxRequests }, 'Rate limit exceeded for user inbox');

      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: 'Too many requests to this user, please try again later.',
        retryAfter: retryAfterSeconds,
      });
      return;
    }

    next();
  });
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

/**
 * Resets the user rate limit store. Useful for testing.
 */
export function resetUserRateLimitStore(): void {
  if (sharedUserStore) {
    sharedUserStore.destroy();
    sharedUserStore = null;
  }
}

/**
 * Gets the current user store for testing purposes.
 * Creates a new store if one doesn't exist.
 *
 * @param windowMs - Time window in milliseconds (default from config)
 * @returns The store instance
 */
export function getUserRateLimitStore(windowMs?: number): UserRateLimitStore {
  const userConfig = getUserRateLimitConfig();
  const finalWindowMs = windowMs ?? userConfig.windowMs;
  return getUserStore(finalWindowMs);
}
