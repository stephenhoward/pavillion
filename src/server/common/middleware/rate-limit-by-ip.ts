import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';

/**
 * Creates an IP-based rate limiter middleware using express-rate-limit.
 *
 * @param maxRequests - Maximum number of requests allowed in the time window
 * @param windowMs - Time window in milliseconds
 * @param endpointName - Name of the endpoint for logging and error messages
 * @returns Express middleware function that enforces rate limiting
 *
 * @example
 * // Allow 5 requests per 15 minutes
 * const limiter = createIpRateLimiter(5, 900000, 'password-reset');
 * app.use('/api/auth/password-reset', limiter);
 */
export function createIpRateLimiter(
  maxRequests: number,
  windowMs: number,
  endpointName: string,
) {
  return rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers

    // Custom handler when rate limit is exceeded
    handler: (req: Request, res: Response) => {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';

      console.warn(`Rate limit exceeded for IP ${ip} on ${endpointName}`);

      // Generate endpoint-specific error message
      const errorMessage = endpointName === 'password-reset'
        ? 'Too many password reset requests from this IP, please try again later.'
        : endpointName === 'login'
          ? 'Too many login requests from this IP, please try again later.'
          : `Too many ${endpointName} requests from this IP, please try again later.`;

      res.status(429).json({
        error: errorMessage,
      });
    },

    // Skip successful requests in rate limit counting (count all requests)
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
  });
}
