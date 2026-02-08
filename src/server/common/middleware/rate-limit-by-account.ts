import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import { Account } from '@/common/model/account';

/**
 * Creates an account-based rate limiter middleware using express-rate-limit.
 *
 * This limiter extracts the authenticated user's account ID from req.user
 * and uses it as the rate limiting key. Designed for authenticated endpoints
 * where per-user throttling is needed.
 *
 * @param maxRequests - Maximum number of requests allowed in the time window
 * @param windowMs - Time window in milliseconds
 * @param endpointName - Name of the endpoint for logging and error messages
 * @returns Express middleware function that enforces rate limiting
 *
 * @example
 * // Allow 20 requests per account per hour
 * const limiter = createAccountRateLimiter(20, 3600000, 'report-submission');
 * app.post('/api/v1/reports', loggedInOnly, limiter, reportHandler);
 */
export function createAccountRateLimiter(
  maxRequests: number,
  windowMs: number,
  endpointName: string,
) {
  return rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,

    // Use authenticated account ID as the key
    keyGenerator: (req: Request) => {
      const account = req.user as Account;
      return account?.id || 'unknown';
    },

    // Custom handler when rate limit is exceeded
    handler: (req: Request, res: Response) => {
      const account = req.user as Account;
      const accountId = account?.id || 'unknown';

      console.warn(
        `Rate limit exceeded for account ${accountId} on ${endpointName}`,
      );

      res.status(429).json({
        error: `Too many ${endpointName} requests for this account, please try again later.`,
      });
    },

    skipSuccessfulRequests: false,
    skipFailedRequests: false,
  });
}
