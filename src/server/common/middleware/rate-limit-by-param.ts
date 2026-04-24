import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('ratelimit');

/**
 * Creates a route-param-keyed rate limiter middleware using express-rate-limit.
 *
 * This limiter extracts a named route parameter from `req.params` and uses
 * it as the rate limiting key. Designed for resource-scoped throttling where
 * the rate cap applies to a specific resource rather than the caller's
 * account or IP (e.g. "4 sync runs per import source per hour" regardless
 * of which editor of the calendar triggers them).
 *
 * When the expected route param is absent from `req.params`, the limiter
 * falls back to the caller's IP address to keep buckets isolated across
 * callers. Without this fallback a middleware reused on a route where the
 * param is optional would collapse every such caller into one shared bucket.
 *
 * @param maxRequests - Maximum requests allowed in the time window
 * @param windowMs - Time window in milliseconds
 * @param endpointName - Endpoint name used for logging and error messages
 * @param paramName - Name of the route parameter used as the rate-limit key
 * @param errorName - Value returned in the 429 `errorName` field. Defaults
 *                    to `'RateLimitError'`. Supply a domain-specific name
 *                    (e.g. `'ImportSourceSyncRateLimitError'`) when the
 *                    frontend needs to distinguish limiter types.
 * @returns Express middleware enforcing rate limiting
 *
 * @example
 * // Allow 4 sync calls per import source per hour
 * const limiter = createParamRateLimiter(
 *   4, 3600000, 'import-source-sync', 'id', 'ImportSourceSyncRateLimitError',
 * );
 * app.post('/calendars/:calendarId/import-sources/:id/sync', limiter, handler);
 */
export function createParamRateLimiter(
  maxRequests: number,
  windowMs: number,
  endpointName: string,
  paramName: string,
  errorName: string = 'RateLimitError',
) {
  return rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,

    keyGenerator: (req: Request) => {
      const value = req.params?.[paramName];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
      return req.ip ?? 'unknown';
    },

    handler: (req: Request, res: Response) => {
      // Resource identifier (`value`) is deliberately omitted from the warn
      // log — per privacy-playbook, resource UUIDs are stable per-resource
      // identifiers and should not appear in non-debug logs. Operators can
      // pivot on endpoint + timestamp for diagnosis.
      logger.warn(
        { param: paramName, endpoint: endpointName },
        'Rate limit exceeded',
      );
      res.status(429).json({
        error: `Too many ${endpointName} requests for this resource, please try again later.`,
        errorName,
      });
    },

    skipSuccessfulRequests: false,
    skipFailedRequests: false,
  });
}
