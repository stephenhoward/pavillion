import config from 'config';
import type { RequestHandler } from 'express';
import { createIpRateLimiter } from './rate-limit-by-ip';
import { createCredentialRateLimiter } from './rate-limit-by-credential';
import { createAccountRateLimiter } from './rate-limit-by-account';
import { createParamRateLimiter } from './rate-limit-by-param';

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
 * Public event-instance detail endpoint rate limiter by IP.
 * Limits: 120 requests per IP per 15 minutes (default config).
 *
 * Rationale: the endpoint can lazily materialize instance rows on cache
 * miss. The limit bounds anonymous-write throughput while remaining
 * permissive enough for legitimate share-link traffic from social crawlers
 * and search engines.
 */
export const publicEventInstanceByIp: RequestHandler = isRateLimitEnabled()
  ? createIpRateLimiter(
    config.get<number>('rateLimit.publicEventInstance.byIp.max'),
    config.get<number>('rateLimit.publicEventInstance.byIp.windowMs'),
    'public-event-instance',
  )
  : noOpMiddleware;

/**
 * Widget configuration rate limiter for authenticated users.
 * Limits: 100 requests per account per 15 minutes (default config).
 * Prevents abuse of widget configuration endpoints.
 */
export const widgetConfigByAccount: RequestHandler = isRateLimitEnabled()
  ? createAccountRateLimiter(
    config.get<number>('rateLimit.widgetConfig.byAccount.max'),
    config.get<number>('rateLimit.widgetConfig.byAccount.windowMs'),
    'widget-config',
  )
  : noOpMiddleware;

/**
 * Calendar funding plan rate limiter for authenticated users.
 * Limits: 30 requests per account per 15 minutes (default config).
 * Prevents abuse of calendar add/remove funding plan endpoints.
 */
export const calendarFundingPlanByAccount: RequestHandler = isRateLimitEnabled()
  ? createAccountRateLimiter(
    config.get<number>('rateLimit.calendarFundingPlan.byAccount.max'),
    config.get<number>('rateLimit.calendarFundingPlan.byAccount.windowMs'),
    'calendar-funding-plan',
  )
  : noOpMiddleware;

/**
 * Checkout session creation rate limiter for authenticated users.
 * Limits: 10 requests per account per 15 minutes (default config).
 * Prevents abuse of Stripe checkout session creation.
 */
export const checkoutSessionByAccount: RequestHandler = isRateLimitEnabled()
  ? createAccountRateLimiter(
    config.get<number>('rateLimit.checkoutSession.byAccount.max'),
    config.get<number>('rateLimit.checkoutSession.byAccount.windowMs'),
    'checkout-session',
  )
  : noOpMiddleware;

/**
 * Import source DNS verification rate limiter, keyed by the source's route
 * param (`id`). Each import source maps to a single hostname, so capping
 * per-source throttles DNS-verification load against the source's hostname
 * while remaining simple and reliable (no DB lookup required mid-request).
 *
 * Limits: 3 verify attempts per source per hour (default config).
 */
export const importSourceVerifyBySource: RequestHandler = isRateLimitEnabled()
  ? createParamRateLimiter(
    config.get<number>('rateLimit.importSource.verifyBySource.max'),
    config.get<number>('rateLimit.importSource.verifyBySource.windowMs'),
    'import-source-verify',
    'id',
    'ImportSourceVerifyRateLimitError',
  )
  : noOpMiddleware;

/**
 * Import source manual-sync rate limiter, keyed by the source id in the URL.
 * Provides an HTTP-layer cap in addition to the per-source sliding window
 * enforced inside SyncService (defense in depth: the middleware stops abusive
 * callers before the DB is touched, while the service-level limiter still
 * holds when sync runs are invoked from the CLI or event bus).
 *
 * Limits: 4 sync attempts per source per hour (default config).
 */
export const importSourceSyncBySource: RequestHandler = isRateLimitEnabled()
  ? createParamRateLimiter(
    config.get<number>('rateLimit.importSource.syncBySource.max'),
    config.get<number>('rateLimit.importSource.syncBySource.windowMs'),
    'import-source-sync',
    'id',
    'ImportSourceSyncRateLimitError',
  )
  : noOpMiddleware;

/**
 * Public configuration site endpoint rate limiter by IP.
 * Limits: 60 requests per IP per minute (default config).
 *
 * Caps anonymous traffic to GET /api/config/v1/site, which is read by every
 * page load on the public site to retrieve registration mode, language
 * settings, and instance metadata. The limit is permissive enough for
 * legitimate page-render traffic while preventing scrape-style abuse.
 */
export const configSiteByIp: RequestHandler = isRateLimitEnabled()
  ? createIpRateLimiter(
    config.get<number>('rateLimit.configSite.byIp.max'),
    config.get<number>('rateLimit.configSite.byIp.windowMs'),
    'config-site',
  )
  : noOpMiddleware;

/**
 * Public account application submission rate limiter by IP address.
 * Limits: 5 requests per IP per 15 minutes (default config).
 */
export const applicationByIp: RequestHandler = isRateLimitEnabled()
  ? createIpRateLimiter(
    config.get<number>('rateLimit.application.byIp.max'),
    config.get<number>('rateLimit.application.byIp.windowMs'),
    'application',
  )
  : noOpMiddleware;

/**
 * Public account application submission rate limiter by email address.
 * Limits: 3 requests per email per 1 hour (default config).
 */
export const applicationByEmail: RequestHandler = isRateLimitEnabled()
  ? createCredentialRateLimiter(
    config.get<number>('rateLimit.application.byEmail.max'),
    config.get<number>('rateLimit.application.byEmail.windowMs'),
    'application',
    'email',
  )
  : noOpMiddleware;

/**
 * Application email-confirmation rate limiter by IP address.
 * Limits: 20 requests per IP per 15 minutes (default config).
 */
export const confirmApplicationByIp: RequestHandler = isRateLimitEnabled()
  ? createIpRateLimiter(
    config.get<number>('rateLimit.applicationConfirm.byIp.max'),
    config.get<number>('rateLimit.applicationConfirm.byIp.windowMs'),
    'application-confirm',
  )
  : noOpMiddleware;
