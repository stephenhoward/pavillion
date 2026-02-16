import config from 'config';
import type { RequestHandler } from 'express';
import { createIpRateLimiter } from './rate-limit-by-ip';
import { createCredentialRateLimiter } from './rate-limit-by-credential';
import { createAccountRateLimiter } from './rate-limit-by-account';

/**
 * Pre-configured rate limiters for specific endpoints.
 *
 * These limiters use configuration values from config/default.yaml and can be
 * disabled globally via the rateLimit.enabled flag.
 *
 * @example
 * import { passwordResetByIp, passwordResetByEmail } from '@/server/common/middleware/rate-limiters';
 *
 * app.post('/api/auth/password-reset',
 *   passwordResetByIp,
 *   passwordResetByEmail,
 *   passwordResetHandler
 * );
 */

/**
 * No-op middleware that allows all requests when rate limiting is disabled.
 */
const noOpMiddleware: RequestHandler = (req, res, next) => next();

/**
 * Checks if rate limiting is enabled in configuration.
 */
function isRateLimitEnabled(): boolean {
  return config.get<boolean>('rateLimit.enabled');
}

/**
 * Password reset rate limiter by IP address.
 * Limits: 5 requests per IP per 15 minutes (default config).
 */
export const passwordResetByIp: RequestHandler = isRateLimitEnabled()
  ? createIpRateLimiter(
    config.get<number>('rateLimit.passwordReset.byIp.max'),
    config.get<number>('rateLimit.passwordReset.byIp.windowMs'),
    'password-reset',
  )
  : noOpMiddleware;

/**
 * Password reset rate limiter by email address.
 * Limits: 3 requests per email per 1 hour (default config).
 */
export const passwordResetByEmail: RequestHandler = isRateLimitEnabled()
  ? createCredentialRateLimiter(
    config.get<number>('rateLimit.passwordReset.byEmail.max'),
    config.get<number>('rateLimit.passwordReset.byEmail.windowMs'),
    'password-reset',
    'email',
  )
  : noOpMiddleware;

/**
 * Login rate limiter by IP address.
 * Limits: 10 requests per IP per 15 minutes (default config).
 */
export const loginByIp: RequestHandler = isRateLimitEnabled()
  ? createIpRateLimiter(
    config.get<number>('rateLimit.login.byIp.max'),
    config.get<number>('rateLimit.login.byIp.windowMs'),
    'login',
  )
  : noOpMiddleware;

/**
 * Login rate limiter by email address.
 * Limits: 5 requests per email per 1 hour (default config).
 */
export const loginByEmail: RequestHandler = isRateLimitEnabled()
  ? createCredentialRateLimiter(
    config.get<number>('rateLimit.login.byEmail.max'),
    config.get<number>('rateLimit.login.byEmail.windowMs'),
    'login',
    'email',
  )
  : noOpMiddleware;

/**
 * Moderation report submission rate limiter by IP address.
 * Limits: 10 requests per IP per 15 minutes (default config).
 */
export const reportSubmissionByIp: RequestHandler = isRateLimitEnabled()
  ? createIpRateLimiter(
    config.get<number>('rateLimit.moderation.reportByIp.max'),
    config.get<number>('rateLimit.moderation.reportByIp.windowMs'),
    'report-submission',
  )
  : noOpMiddleware;

/**
 * Moderation report verification rate limiter by IP address.
 * Limits: 20 requests per IP per 15 minutes (default config).
 */
export const reportVerificationByIp: RequestHandler = isRateLimitEnabled()
  ? createIpRateLimiter(
    config.get<number>('rateLimit.moderation.verifyByIp.max'),
    config.get<number>('rateLimit.moderation.verifyByIp.windowMs'),
    'report-verification',
  )
  : noOpMiddleware;

/**
 * Moderation report submission rate limiter by email address.
 * Limits: 3 verification emails per email per 24 hours (default config).
 */
export const reportSubmissionByEmail: RequestHandler = isRateLimitEnabled()
  ? createCredentialRateLimiter(
    config.get<number>('rateLimit.moderation.byEmail.max'),
    config.get<number>('rateLimit.moderation.byEmail.windowMs'),
    'report-submission',
    'email',
  )
  : noOpMiddleware;

/**
 * Moderation report submission rate limiter by authenticated account.
 * Limits: 20 reports per account per 1 hour (default config).
 */
export const reportSubmissionByAccount: RequestHandler = isRateLimitEnabled()
  ? createAccountRateLimiter(
    config.get<number>('rateLimit.moderation.byAccount.max'),
    config.get<number>('rateLimit.moderation.byAccount.windowMs'),
    'report-submission',
  )
  : noOpMiddleware;

/**
 * Public widget data rate limiter by IP address.
 * Limits: 300 requests per IP per 15 minutes (default config).
 * More permissive than auth endpoints due to legitimate embedded widget traffic.
 */
export const publicWidgetByIp: RequestHandler = isRateLimitEnabled()
  ? createIpRateLimiter(
    config.get<number>('rateLimit.publicWidget.byIp.max'),
    config.get<number>('rateLimit.publicWidget.byIp.windowMs'),
    'public-widget',
  )
  : noOpMiddleware;

/**
 * Widget configuration rate limiter for authenticated users.
 * Limits: 100 requests per account per 15 minutes.
 * Prevents abuse of widget configuration endpoints.
 */
export const widgetConfigByAccount: RequestHandler = isRateLimitEnabled()
  ? createAccountRateLimiter(
    100,
    15 * 60 * 1000, // 15 minutes
    'widget-config',
  )
  : noOpMiddleware;
