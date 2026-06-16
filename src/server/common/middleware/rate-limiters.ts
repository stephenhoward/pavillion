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
 * import { limitPasswordResetByIp, limitPasswordResetByEmail } from '@/server/common/middleware/rate-limiters';
 *
 * app.post('/api/auth/password-reset',
 *   limitPasswordResetByIp,
 *   limitPasswordResetByEmail,
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
export const limitPasswordResetByIp: RequestHandler = isRateLimitEnabled()
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
export const limitPasswordResetByEmail: RequestHandler = isRateLimitEnabled()
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
export const limitLoginByIp: RequestHandler = isRateLimitEnabled()
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
export const limitLoginByEmail: RequestHandler = isRateLimitEnabled()
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
export const limitReportSubmissionByIp: RequestHandler = isRateLimitEnabled()
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
export const limitReportVerificationByIp: RequestHandler = isRateLimitEnabled()
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
export const limitReportSubmissionByEmail: RequestHandler = isRateLimitEnabled()
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
export const limitReportSubmissionByAccount: RequestHandler = isRateLimitEnabled()
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
export const limitPublicWidgetByIp: RequestHandler = isRateLimitEnabled()
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
export const limitPublicEventInstanceByIp: RequestHandler = isRateLimitEnabled()
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
export const limitWidgetConfigByAccount: RequestHandler = isRateLimitEnabled()
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
export const limitCalendarFundingPlanByAccount: RequestHandler = isRateLimitEnabled()
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
export const limitCheckoutSessionByAccount: RequestHandler = isRateLimitEnabled()
  ? createAccountRateLimiter(
    config.get<number>('rateLimit.checkoutSession.byAccount.max'),
    config.get<number>('rateLimit.checkoutSession.byAccount.windowMs'),
    'checkout-session',
  )
  : noOpMiddleware;

/**
 * Stripe funding webhook rate limiter by IP address.
 * Limits: 300 requests per IP per minute (default config).
 *
 * Belt-and-braces behind Stripe signature verification (DEC-007), which is the
 * primary defense for POST /api/funding/webhooks/stripe. Deliberately generous:
 * Stripe can deliver many events per minute and retries failed deliveries for
 * up to 72 hours, so this limiter must never gate legitimate provider traffic.
 */
export const limitFundingWebhookByIp: RequestHandler = isRateLimitEnabled()
  ? createIpRateLimiter(
    config.get<number>('rateLimit.fundingWebhook.byIp.max'),
    config.get<number>('rateLimit.fundingWebhook.byIp.windowMs'),
    'funding-webhook',
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
export const limitImportSourceVerifyBySource: RequestHandler = isRateLimitEnabled()
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
export const limitImportSourceSyncBySource: RequestHandler = isRateLimitEnabled()
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
export const limitConfigSiteByIp: RequestHandler = isRateLimitEnabled()
  ? createIpRateLimiter(
    config.get<number>('rateLimit.configSite.byIp.max'),
    config.get<number>('rateLimit.configSite.byIp.windowMs'),
    'config-site',
  )
  : noOpMiddleware;

/**
 * Public calendar discovery list endpoint rate limiter by IP.
 * Limits: 60 requests per IP per minute (default config).
 *
 * Caps anonymous traffic to GET /api/public/v1/calendars, which is read by
 * the /view/ discovery landing page. The limit is permissive enough for
 * legitimate page-render and pagination traffic while preventing scrape-style
 * abuse of the listed-calendar enumeration surface.
 */
export const limitPublicCalendarListByIp: RequestHandler = isRateLimitEnabled()
  ? createIpRateLimiter(
    config.get<number>('rateLimit.publicCalendarList.byIp.max'),
    config.get<number>('rateLimit.publicCalendarList.byIp.windowMs'),
    'public-calendar-list',
  )
  : noOpMiddleware;

/**
 * Public account application submission rate limiter by IP address.
 * Limits: 5 requests per IP per 15 minutes (default config).
 */
export const limitApplicationByIp: RequestHandler = isRateLimitEnabled()
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
export const limitApplicationByEmail: RequestHandler = isRateLimitEnabled()
  ? createCredentialRateLimiter(
    config.get<number>('rateLimit.application.byEmail.max'),
    config.get<number>('rateLimit.application.byEmail.windowMs'),
    'application',
    'email',
  )
  : noOpMiddleware;

/**
 * Public account registration rate limiter by IP address.
 * Limits: 5 requests per IP per 15 minutes (default config).
 */
export const limitRegisterByIp: RequestHandler = isRateLimitEnabled()
  ? createIpRateLimiter(
    config.get<number>('rateLimit.register.byIp.max'),
    config.get<number>('rateLimit.register.byIp.windowMs'),
    'register',
  )
  : noOpMiddleware;

/**
 * Public account registration rate limiter by email address.
 *
 * Limits: 3 requests per email per 1 hour (default config). The limiter
 * increments uniformly on every attempt regardless of whether the email
 * already maps to an account, so the rate-limit signal cannot be used to
 * enumerate registered accounts (DEC-004).
 */
export const limitRegisterByEmail: RequestHandler = isRateLimitEnabled()
  ? createCredentialRateLimiter(
    config.get<number>('rateLimit.register.byEmail.max'),
    config.get<number>('rateLimit.register.byEmail.windowMs'),
    'register',
    'email',
  )
  : noOpMiddleware;

/**
 * Application email-confirmation rate limiter by IP address.
 * Limits: 20 requests per IP per 15 minutes (default config).
 */
export const limitConfirmApplicationByIp: RequestHandler = isRateLimitEnabled()
  ? createIpRateLimiter(
    config.get<number>('rateLimit.application.confirm.byIp.max'),
    config.get<number>('rateLimit.application.confirm.byIp.windowMs'),
    'application-confirm',
  )
  : noOpMiddleware;

/**
 * Password-reset confirmation rate limiter by IP address.
 *
 * Caps token-redemption attempts against POST /api/auth/v1/reset-password/:code
 * to defend against brute-force guessing of reset codes.
 *
 * Limits: 20 requests per IP per 15 minutes (default config).
 */
export const limitConfirmPasswordResetByIp: RequestHandler = isRateLimitEnabled()
  ? createIpRateLimiter(
    config.get<number>('rateLimit.passwordReset.confirm.byIp.max'),
    config.get<number>('rateLimit.passwordReset.confirm.byIp.windowMs'),
    'password-reset-confirm',
  )
  : noOpMiddleware;

/**
 * Invitation-acceptance rate limiter by IP address.
 *
 * Caps token-redemption attempts against POST /api/v1/invitations/:code to
 * defend against brute-force guessing of invitation codes.
 *
 * Limits: 20 requests per IP per 15 minutes (default config).
 */
export const limitAcceptInvitationByIp: RequestHandler = isRateLimitEnabled()
  ? createIpRateLimiter(
    config.get<number>('rateLimit.invitation.accept.byIp.max'),
    config.get<number>('rateLimit.invitation.accept.byIp.windowMs'),
    'invitation-accept',
  )
  : noOpMiddleware;

/**
 * Email-change rate limiter by authenticated account.
 *
 * Caps POST /api/auth/v1/email per account. Per the audit (pv-qqno.1, OQ2
 * verdict), changeEmail verifies the password then writes the new email
 * directly to the DB — there is no outbound email and no confirm route, so the
 * original outbound-email amplifier rationale does not apply. This account-keyed
 * limiter is probe/enumeration defense-in-depth: it bounds password-oracle
 * probing (InvalidPasswordError) and email-existence enumeration
 * (EmailAlreadyExistsError) attempt rate. It does NOT close the differential-
 * response enumeration oracle itself. Keyed on the authenticated account, so it
 * must be wired after loggedInOnly.
 *
 * Limits: 10 requests per account per 1 hour (default config).
 */
export const limitEmailChangeByAccount: RequestHandler = isRateLimitEnabled()
  ? createAccountRateLimiter(
    config.get<number>('rateLimit.emailChange.byAccount.max'),
    config.get<number>('rateLimit.emailChange.byAccount.windowMs'),
    'email-change',
  )
  : noOpMiddleware;

/**
 * Email-change rate limiter by destination (candidate) address.
 *
 * Sits alongside limitEmailChangeByAccount on POST /api/auth/v1/email. Keyed on
 * the requester-supplied destination email (req.body.email) across ALL accounts,
 * it caps how often any single address can be targeted as a pending email-change
 * recipient — the email-bombing defense (epic pv-91a3): a multi-account attacker
 * cannot flood a victim address with confirmation emails, because the per-address
 * window is shared regardless of which account initiates.
 *
 * Cannot become an enumeration oracle: the key is the attacker-supplied address,
 * so a 429 only tells the requester they hit their own cap on an address they
 * chose — it reveals nothing about whether that address maps to an account.
 *
 * Keyed on the NORMALIZED destination (trim + lowercase), mirroring the
 * normalization initiateEmailChange applies before using the address
 * (src/server/authentication/service/auth.ts). Without this, an attacker could
 * split the per-address counter with case/whitespace variants (Victim@x.com vs
 * victim@x.com) and bomb the same mailbox past the cap. Normalization happens in
 * createCredentialRateLimiter's keyGenerator, so every credential limiter
 * (including this one) shares one bucket across case/whitespace variants. Uses
 * the same credential factory and 'email' field as limitRegisterByEmail.
 *
 * Limits: 2 requests per destination address per 24 hours (default config).
 */
export const limitEmailChangeByDestination: RequestHandler = isRateLimitEnabled()
  ? createCredentialRateLimiter(
    config.get<number>('rateLimit.emailChange.byDestination.max'),
    config.get<number>('rateLimit.emailChange.byDestination.windowMs'),
    'email-change',
    'email',
  )
  : noOpMiddleware;

/**
 * Email-change confirmation rate limiter by IP address.
 *
 * Caps token-redemption attempts against POST /api/auth/v1/email/confirm/:token
 * to defend against brute-force guessing of email-change codes. Mirrors
 * limitConfirmPasswordResetByIp: the confirmation code is a randomBytes(16)
 * CSPRNG token, so this is an abuse cap rather than a guessing wall.
 *
 * Limits: 20 requests per IP per 15 minutes (default config).
 */
export const limitConfirmEmailChangeByIp: RequestHandler = isRateLimitEnabled()
  ? createIpRateLimiter(
    config.get<number>('rateLimit.emailChange.confirm.byIp.max'),
    config.get<number>('rateLimit.emailChange.confirm.byIp.windowMs'),
    'email-change-confirm',
  )
  : noOpMiddleware;
