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
 * @param maxRequests - Maximum requests allowed in the time window
 * @param windowMs - Time window in milliseconds
 * @param endpointName - Endpoint name used for logging and error messages
 * @param paramName - Name of the route parameter used as the rate-limit key
 * @returns Express middleware enforcing rate limiting
 *
 * @example
 * // Allow 4 sync calls per import source per hour
 * const limiter = createParamRateLimiter(4, 3600000, 'import-source-sync', 'id');
 * app.post('/calendars/:calendarId/import-sources/:id/sync', limiter, handler);
 */
export function createParamRateLimiter(
  maxRequests: number,
  windowMs: number,
  endpointName: string,
  paramName: string,
) {
  return rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,

    keyGenerator: (req: Request) => {
      const value = req.params?.[paramName];
      return typeof value === 'string' && value.length > 0 ? value : 'unknown';
    },

    handler: (req: Request, res: Response) => {
      const value = req.params?.[paramName];
      logger.warn(
        { param: paramName, value, endpoint: endpointName },
        'Rate limit exceeded',
      );
      res.status(429).json({
        error: `Too many ${endpointName} requests for this resource, please try again later.`,
        errorName: 'ImportSourceVerifyRateLimitError',
      });
    },

    skipSuccessfulRequests: false,
    skipFailedRequests: false,
  });
}
