import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import { redactEmail } from '@/server/common/helpers/redact-email';

/**
 * Creates a credential-based rate limiter middleware using express-rate-limit.
 *
 * This limiter extracts a credential (like email) from the request body and uses it
 * as the rate limiting key. When limits are exceeded, the credential is logged in
 * redacted form for security.
 *
 * @param maxRequests - Maximum number of requests allowed in the time window
 * @param windowMs - Time window in milliseconds
 * @param endpointName - Name of the endpoint for logging and error messages
 * @param credentialField - Name of the field in req.body containing the credential
 * @returns Express middleware function that enforces rate limiting
 *
 * @example
 * // Allow 3 requests per email per hour
 * const limiter = createCredentialRateLimiter(3, 3600000, 'password-reset', 'email');
 * app.use('/api/auth/password-reset', limiter);
 */
export function createCredentialRateLimiter(
  maxRequests: number,
  windowMs: number,
  endpointName: string,
  credentialField: string,
) {
  return rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers

    // Use credential from request body as the key
    keyGenerator: (req: Request) => {
      const credential = req.body?.[credentialField];
      return credential || 'unknown';
    },

    // Custom handler when rate limit is exceeded
    handler: (req: Request, res: Response) => {
      const credential = req.body?.[credentialField];
      const redactedCredential = redactEmail(credential);

      console.warn(
        `Rate limit exceeded for ${redactedCredential} on ${endpointName}`,
      );

      // Generate endpoint-specific error message
      const errorMessage = endpointName === 'password-reset'
        ? `Too many password reset requests for this ${credentialField}, please try again later.`
        : endpointName === 'login'
          ? `Too many login requests for this ${credentialField}, please try again later.`
          : `Too many ${endpointName} requests for this ${credentialField}, please try again later.`;

      res.status(429).json({
        error: errorMessage,
      });
    },

    // Skip successful requests in rate limit counting (count all requests)
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
  });
}
