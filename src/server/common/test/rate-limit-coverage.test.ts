import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express, { Application } from 'express';
import { EventEmitter } from 'events';

import ConfigurationDomain from '@/server/configuration';
import SetupDomain from '@/server/setup';
import EmailDomain from '@/server/email';
import AccountsDomain from '@/server/accounts';
import AuthenticationDomain from '@/server/authentication';
import FundingDomain from '@/server/funding';
import CalendarDomain from '@/server/calendar';
import ModerationDomain from '@/server/moderation';
import HousekeepingDomain from '@/server/housekeeping';
import ActivityPubDomain from '@/server/activitypub';
import NotificationsDomain from '@/server/notifications';
import PublicCalendarDomain from '@/server/public';
import MediaDomain from '@/server/media';
// Deliberate cross-domain test-time import. AP_RATE_LIMITER_MARKER and the
// reset helpers are test-support infrastructure, not AP domain API — routing
// them through the ActivityPub interface would pollute that interface with
// test-only symbols. This common-domain guard reaches directly into the AP
// middleware module for them, mirroring the backfill.ts "Exported for test
// reset only" precedent. (The marker recognizes AP inbox limiters; the reset
// helpers tear down the AP limiters' process-global singleton stores in afterAll.)
import {
  AP_RATE_LIMITER_MARKER,
  resetActorRateLimitStore,
  resetCalendarRateLimitStore,
  resetUserRateLimitStore,
} from '@/server/activitypub/middleware/rate-limit';

/**
 * =============================================================================
 * RATE-LIMIT COVERAGE GUARD (epic pv-qqno capstone)
 * =============================================================================
 *
 * This file is a CI guard, not a behavioral test. It introspects the REAL
 * Express router stack of the fully-assembled application and enforces two
 * invariants over the rate-limit posture of the route surface. It asserts
 * PRESENCE of a rate-limit middleware, never thresholds or runtime behavior —
 * per-limiter behavior is covered by the integration tests under each domain's
 * `test/integration/rate_limiting.test.ts`.
 *
 * Two guards:
 *
 *   1. REGRESSION GUARD — every route on HIGH_ABUSE_RISK_ROUTES must carry at
 *      least one rate-limit middleware in its layer stack. If a limiter is
 *      removed from one of these high-value abuse surfaces, this guard fails.
 *
 *   2. COMPLETENESS GUARD — every registered MUTATING route (POST/PUT/PATCH/
 *      DELETE) must be classified: it appears on HIGH_ABUSE_RISK_ROUTES OR on
 *      the reviewed REVIEWED_NO_LIMITER_ROUTES allow-list. A new, unclassified
 *      mutating route fails CI with an actionable message — forcing a human to
 *      make an explicit rate-limit decision before the route can merge.
 *
 * -----------------------------------------------------------------------------
 * MAINTENANCE PROTOCOL — read this before editing the lists below.
 * -----------------------------------------------------------------------------
 *
 * The two lists in this file are the CANONICAL in-repo rate-limit risk taxonomy.
 * The external audit (pv-qqno.1, pavillion-security route-rate-limit-audit.md)
 * documents the original survey, but THIS FILE is the source of truth going
 * forward. When you add a new mutating route and CI fails here, do ONE of:
 *
 *   A) The route is a high-value abuse surface (anonymous-reachable AND triggers
 *      an amplifiable side effect: outbound email, row materialization, private-
 *      surface enumeration, or unbounded federation fan-in). Attach a rate-limit
 *      middleware to the route, then add it to HIGH_ABUSE_RISK_ROUTES. The
 *      regression guard will then hold the limiter in place.
 *
 *   B) The route does NOT warrant a limiter (e.g. admin-only CRUD bounded by
 *      ownership checks, or already gated by setup-mode middleware). Add it to
 *      REVIEWED_NO_LIMITER_ROUTES with a one-line rationale. Allow-listing is a
 *      reviewed decision — it records that a human looked at the route and judged
 *      the residual abuse risk acceptable. Do NOT allow-list a route merely to
 *      make CI pass; that defeats the guard's purpose.
 *
 * When you allow-list a route, mirror the rationale taxonomy already used below:
 * "admin-only" (auth: adminOnly), "authenticated CRUD" (loggedInOnly, ownership-
 * bounded), "setup-only" (gated by setup-mode middleware), or a specific note.
 *
 * -----------------------------------------------------------------------------
 * LIMITER DETECTION STRATEGY (two-module split).
 * -----------------------------------------------------------------------------
 *
 * Rate-limit middleware comes from two sources with different shapes, so we use
 * two name-INDEPENDENT structural signals (function names are fragile and minify
 * away under bundling):
 *
 *   - Common limiters (src/server/common/middleware/rate-limiters.ts) wrap
 *     express-rate-limit. Every express-rate-limit middleware exposes `getKey`
 *     and `resetKey` function properties; we detect those. (When config
 *     rateLimit.enabled is false these collapse to no-op passthroughs and would
 *     NOT be detected — which is exactly why this suite runs under
 *     vitest.ratelimiting.config.ts with NODE_CONFIG rateLimit.enabled=true.)
 *
 *   - ActivityPub inbox limiters (src/server/activitypub/middleware/rate-limit.ts)
 *     are plain closures over an in-memory LRU store with no express-rate-limit
 *     signature. The factories tag each returned closure with a non-enumerable
 *     AP_RATE_LIMITER_MARKER property; we detect that marker. This is why the AP
 *     inbox routes are recognized despite carrying neither a named export nor a
 *     getKey/resetKey method.
 */

// -----------------------------------------------------------------------------
// HIGH_ABUSE_RISK_ROUTES — regression guard targets.
//
// Each of these MUST carry >=1 rate-limit middleware. These are the high-value
// abuse surfaces from the pv-qqno threat model (A11/B4/C6): anonymous-reachable
// routes that send outbound email, materialize rows, enumerate private surfaces,
// or fan in federation traffic.
// -----------------------------------------------------------------------------
const HIGH_ABUSE_RISK_ROUTES: { method: string; path: string }[] = [
  // Account signup (open-registration path) — IP + email limiters.
  { method: 'POST', path: '/api/v1/register' },
  // Application-gated signup path — IP + email limiters.
  { method: 'POST', path: '/api/v1/applications' },
  { method: 'POST', path: '/api/v1/applications/confirm/:token' },
  // Calendar-editor invitation acceptance (noUserOnly) — IP limiter.
  { method: 'POST', path: '/api/v1/invitations/:code' },
  // Login — IP + email limiters.
  { method: 'POST', path: '/api/auth/v1/login' },
  // Password reset initiate — IP + email limiters.
  { method: 'POST', path: '/api/auth/v1/reset-password' },
  // Password reset confirm (reset-code brute-force surface) — IP limiter.
  { method: 'POST', path: '/api/auth/v1/reset-password/:code' },
  // Email change (credential-probe / enumeration hardening) — account limiter.
  { method: 'POST', path: '/api/auth/v1/email' },
  // Email change confirm (confirmation-token brute-force surface) — IP limiter.
  { method: 'POST', path: '/api/auth/v1/email/confirm/:token' },
  // Stripe funding webhook — IP limiter (defense in depth; signature is primary).
  { method: 'POST', path: '/api/funding/webhooks/stripe' },
  // Public moderation report submission — IP + email limiters.
  { method: 'POST', path: '/api/public/v1/events/:eventId/reports' },
  // Authenticated moderation report submission — IP + account limiters.
  { method: 'POST', path: '/api/v1/reports' },
  // ActivityPub federation inboxes — actor + calendar/user limiters (run before
  // signature verification per DEC-013 ingest-boundary posture).
  { method: 'POST', path: '/calendars/:urlname/inbox' },
  { method: 'POST', path: '/users/:username/inbox' },
  // ICS file upload — buffers a 10 MiB body into memory then CPU-parses it and
  // materializes event rows in one transaction (amplifiable side effect);
  // per-account limited (limitWidgetConfigByAccount).
  { method: 'POST', path: '/api/v1/calendars/:calendarId/import-sources/file' },
];

// -----------------------------------------------------------------------------
// REVIEWED_NO_LIMITER_ROUTES — completeness guard allow-list.
//
// Mutating routes that have been reviewed and judged not to warrant a route-level
// rate-limit middleware. Seeded from the pv-qqno.1 audit route table (all "low"
// and reviewed "medium" verdicts). Rationale taxonomy:
//   admin-only          — auth: adminOnly; bounded operator surface.
//   authenticated CRUD  — loggedInOnly; ownership/tenant-bounded mutation.
//   setup-only          — reachable only in first-run setup mode.
//   per-account limited  — allow-listed as acceptable WITHOUT a guard-enforced
//                          route-level limiter. These routes are documented as
//                          carrying a per-account limiter (widget/funding/import),
//                          but this guard does NOT verify that limiter's presence
//                          — it only requires the route to be classified. The
//                          per-account limiter, where present, is asserted by the
//                          per-domain rate_limiting.test.ts integration tests, not
//                          here. Treat this label as "reviewed, not a high-abuse
//                          surface", not as a coverage guarantee.
// -----------------------------------------------------------------------------
const REVIEWED_NO_LIMITER_ROUTES: { method: string; path: string; reason: string }[] = [
  // --- Accounts (admin / authenticated CRUD) ---
  { method: 'PATCH', path: '/api/v1/accounts/me/profile', reason: 'authenticated CRUD (own profile)' },
  { method: 'POST', path: '/api/v1/admin/applications/:id/approve', reason: 'admin-only' },
  { method: 'POST', path: '/api/v1/admin/applications/:id/deny', reason: 'admin-only' },
  { method: 'POST', path: '/api/v1/admin/invitations', reason: 'admin-only' },
  { method: 'POST', path: '/api/v1/applications/:id', reason: 'admin-only (application decision)' },
  { method: 'POST', path: '/api/v1/invitations', reason: 'authenticated CRUD (outbound-email cost noted in audit; follow-up, not high-risk)' },
  { method: 'POST', path: '/api/v1/invitations/:id/resend', reason: 'admin-only' },
  { method: 'DELETE', path: '/api/v1/invitations/:id', reason: 'admin-only' },

  // --- Authentication ---
  // (all auth mutating routes are high-risk; none allow-listed)

  // --- Configuration ---
  { method: 'POST', path: '/api/config/v1/site', reason: 'admin-only' },

  // --- Setup (first-run only) ---
  { method: 'POST', path: '/api/v1/setup', reason: 'setup-only (gated by setup-mode middleware)' },

  // --- Funding (admin + per-account limited) ---
  { method: 'POST', path: '/api/funding/v1/admin/settings', reason: 'admin-only' },
  { method: 'PUT', path: '/api/funding/v1/admin/providers/:providerType', reason: 'admin-only' },
  { method: 'DELETE', path: '/api/funding/v1/admin/providers/:providerType', reason: 'admin-only' },
  { method: 'POST', path: '/api/funding/v1/admin/providers/stripe/configure', reason: 'admin-only' },
  { method: 'POST', path: '/api/funding/v1/admin/providers/paypal/configure', reason: 'admin-only' },
  { method: 'POST', path: '/api/funding/v1/admin/funding-plans/:id/cancel', reason: 'admin-only' },
  { method: 'POST', path: '/api/funding/v1/admin/grants', reason: 'admin-only' },
  { method: 'DELETE', path: '/api/funding/v1/admin/grants/:id', reason: 'admin-only' },
  { method: 'POST', path: '/api/funding/v1/cancel', reason: 'authenticated CRUD (own funding plan)' },
  { method: 'POST', path: '/api/funding/v1/calendars', reason: 'per-account limited (limitCalendarFundingPlanByAccount)' },
  { method: 'DELETE', path: '/api/funding/v1/calendars/:calendarId', reason: 'per-account limited (limitCalendarFundingPlanByAccount)' },
  { method: 'POST', path: '/api/funding/v1/checkout-sessions', reason: 'per-account limited (limitCheckoutSessionByAccount)' },

  // --- Calendar (authenticated, ownership-bounded CRUD) ---
  { method: 'POST', path: '/api/v1/calendars', reason: 'authenticated CRUD' },
  { method: 'PATCH', path: '/api/v1/calendars/:calendarId/settings', reason: 'authenticated CRUD' },
  { method: 'POST', path: '/api/v1/calendars/:calendarId/editors', reason: 'authenticated CRUD' },
  { method: 'DELETE', path: '/api/v1/calendars/:calendarId/editors/remote', reason: 'authenticated CRUD' },
  { method: 'DELETE', path: '/api/v1/calendars/:calendarId/editors/:editorId', reason: 'authenticated CRUD' },
  { method: 'PUT', path: '/api/v1/calendars/:calendarId/editors/:editorId/permissions', reason: 'authenticated CRUD' },
  { method: 'DELETE', path: '/api/v1/calendars/:calendarId/invitations/:invitationId', reason: 'authenticated CRUD' },
  { method: 'POST', path: '/api/v1/calendars/:calendarId/invitations/:invitationId/resend', reason: 'authenticated CRUD' },
  { method: 'POST', path: '/api/v1/calendars/:calendarId/categories', reason: 'authenticated CRUD' },
  { method: 'POST', path: '/api/v1/calendars/:calendarId/categories/merge', reason: 'authenticated CRUD' },
  { method: 'PUT', path: '/api/v1/calendars/:calendarId/categories/:categoryId', reason: 'authenticated CRUD' },
  { method: 'DELETE', path: '/api/v1/calendars/:calendarId/categories/:categoryId', reason: 'authenticated CRUD' },
  { method: 'PUT', path: '/api/v1/calendars/:calendarId/following/:actorId/category-mappings', reason: 'authenticated CRUD' },
  { method: 'POST', path: '/api/v1/calendars/:calendarId/locations', reason: 'authenticated CRUD' },
  { method: 'PUT', path: '/api/v1/calendars/:calendarId/locations/:locationId', reason: 'authenticated CRUD' },
  { method: 'DELETE', path: '/api/v1/calendars/:calendarId/locations/:locationId', reason: 'authenticated CRUD' },
  { method: 'POST', path: '/api/v1/calendars/:calendarId/locations/:locationId/reassign-events', reason: 'authenticated CRUD' },
  { method: 'POST', path: '/api/v1/calendars/:calendarId/series', reason: 'authenticated CRUD' },
  { method: 'PUT', path: '/api/v1/calendars/:calendarId/series/:seriesId', reason: 'authenticated CRUD' },
  { method: 'DELETE', path: '/api/v1/calendars/:calendarId/series/:seriesId', reason: 'authenticated CRUD' },
  { method: 'POST', path: '/api/v1/events', reason: 'authenticated CRUD' },
  { method: 'PUT', path: '/api/v1/events/:id', reason: 'authenticated CRUD' },
  { method: 'DELETE', path: '/api/v1/events/:id', reason: 'authenticated CRUD' },
  { method: 'POST', path: '/api/v1/events/bulk-assign-categories', reason: 'authenticated CRUD' },
  { method: 'PUT', path: '/api/v1/events/:id/categories', reason: 'authenticated CRUD' },
  { method: 'POST', path: '/api/v1/events/:eventId/occurrences/cancel', reason: 'authenticated CRUD' },
  { method: 'DELETE', path: '/api/v1/events/:eventId/occurrences/cancel', reason: 'authenticated CRUD' },
  { method: 'POST', path: '/api/v1/events/:eventId/categories', reason: 'authenticated CRUD' },
  { method: 'POST', path: '/api/v1/events/:eventId/categories/:categoryId', reason: 'authenticated CRUD' },
  { method: 'DELETE', path: '/api/v1/events/:eventId/categories/:categoryId', reason: 'authenticated CRUD' },
  { method: 'POST', path: '/api/v1/events/:eventId/series/:seriesId', reason: 'authenticated CRUD' },
  { method: 'DELETE', path: '/api/v1/events/:eventId/series/:seriesId', reason: 'authenticated CRUD' },
  // Widget config + import-source routes carry limitWidgetConfigByAccount / import limiters
  // (per-account), classified here rather than as high-risk surfaces.
  { method: 'PUT', path: '/api/v1/calendars/:calendarId/widget/domain', reason: 'per-account limited (limitWidgetConfigByAccount)' },
  { method: 'DELETE', path: '/api/v1/calendars/:calendarId/widget/domain', reason: 'per-account limited (limitWidgetConfigByAccount)' },
  { method: 'PUT', path: '/api/v1/calendars/:calendarId/widget/config', reason: 'per-account limited (limitWidgetConfigByAccount)' },
  { method: 'POST', path: '/api/v1/calendars/:calendarId/import-sources', reason: 'per-account limited (limitWidgetConfigByAccount)' },
  { method: 'DELETE', path: '/api/v1/calendars/:calendarId/import-sources/:id', reason: 'per-account limited (limitWidgetConfigByAccount)' },
  { method: 'POST', path: '/api/v1/calendars/:calendarId/import-sources/:id/verify-issue', reason: 'per-account limited (limitWidgetConfigByAccount)' },
  { method: 'POST', path: '/api/v1/calendars/:calendarId/import-sources/:id/verify', reason: 'per-source limited (limitImportSourceVerifyBySource)' },
  { method: 'POST', path: '/api/v1/calendars/:calendarId/import-sources/:id/sync', reason: 'per-source limited (limitImportSourceSyncBySource)' },

  // --- Media ---
  { method: 'POST', path: '/api/v1/media/:calendarId', reason: 'authenticated CRUD (upload-abuse follow-up noted in audit; not high-risk)' },

  // --- Notifications ---
  { method: 'PATCH', path: '/api/v1/notification/:id', reason: 'authenticated CRUD (own notification)' },

  // --- ActivityPub social (authenticated) ---
  { method: 'POST', path: '/api/v1/social/follows', reason: 'authenticated CRUD' },
  { method: 'PATCH', path: '/api/v1/social/follows/:id', reason: 'authenticated CRUD' },
  { method: 'DELETE', path: '/api/v1/social/follows/:id', reason: 'authenticated CRUD' },
  { method: 'POST', path: '/api/v1/social/shares', reason: 'authenticated CRUD' },
  { method: 'DELETE', path: '/api/v1/social/shares/:id', reason: 'authenticated CRUD' },

  // --- Moderation (admin + authenticated calendar-scoped) ---
  { method: 'PUT', path: '/api/v1/calendars/:calendarId/reports/:reportId', reason: 'authenticated CRUD (calendar-scoped moderation)' },
  { method: 'POST', path: '/api/v1/calendars/:calendarId/reports/:reportId/resolve', reason: 'authenticated CRUD (calendar-scoped moderation)' },
  { method: 'POST', path: '/api/v1/calendars/:calendarId/reports/:reportId/dismiss', reason: 'authenticated CRUD (calendar-scoped moderation)' },
  { method: 'POST', path: '/api/v1/calendars/:calendarId/reports/:reportId/forward', reason: 'authenticated CRUD (calendar-scoped moderation)' },
  { method: 'POST', path: '/api/v1/admin/reports', reason: 'admin-only' },
  { method: 'PUT', path: '/api/v1/admin/reports/:reportId', reason: 'admin-only' },
  { method: 'POST', path: '/api/v1/admin/reports/:reportId/forward-to-admin', reason: 'admin-only' },
  { method: 'PUT', path: '/api/v1/admin/moderation/settings', reason: 'admin-only' },
  { method: 'POST', path: '/api/v1/admin/moderation/block-instance', reason: 'admin-only' },
  { method: 'DELETE', path: '/api/v1/admin/moderation/blocked-instances/:domain', reason: 'admin-only' },
  { method: 'POST', path: '/api/v1/admin/moderation/blocked-reporters', reason: 'admin-only' },
  { method: 'DELETE', path: '/api/v1/admin/moderation/blocked-reporters/:emailHash', reason: 'admin-only' },
];

// =============================================================================
// Router-stack introspection (Express 4).
// =============================================================================

interface DiscoveredRoute {
  method: string;
  path: string;
  hasRateLimiter: boolean;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** express-rate-limit middleware exposes getKey/resetKey methods. */
function isCommonRateLimiter(handle: any): boolean {
  return !!handle && typeof handle.getKey === 'function' && typeof handle.resetKey === 'function';
}

/** AP inbox limiters carry the non-enumerable AP_RATE_LIMITER_MARKER. */
function isApRateLimiter(handle: any): boolean {
  return !!handle && (handle as any)[AP_RATE_LIMITER_MARKER] === true;
}

function isRateLimiter(handle: any): boolean {
  return isCommonRateLimiter(handle) || isApRateLimiter(handle);
}

/**
 * Reconstructs the mount-path fragment a router layer was mounted under from its
 * compiled regexp + param keys. Express 4 stores `app.use('/x', router)` as a
 * Layer whose regexp encodes '/x'; nested params become capture groups that map
 * positionally to `layer.keys`.
 *
 * VALIDATED AGAINST EXPRESS 4.x (4.22.2 at time of writing). The hardcoded
 * regexp-source patterns below depend on Express 4's internal path-to-regexp
 * encoding. Express 5 (path-to-regexp v8) changes this encoding and stores
 * layer matchers differently — under it these replacements would silently
 * reconstruct wrong/empty paths. The positive-path sanity assertion in the
 * "introspection sanity check" test guards against that: if reconstruction
 * breaks, a KNOWN full path will go missing and that assertion fails loudly
 * with a clear signal, rather than producing a cascade of misattributed
 * "route not found" / "unclassified route" failures.
 */
function reconstructMountPath(layer: any): string {
  if (layer.regexp && layer.regexp.fast_slash) return '';
  const keys = layer.keys || [];
  const src: string = layer.regexp && layer.regexp.source ? layer.regexp.source : '';
  let path = src
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\(\?=\\\/\|\$\)$/, '')
    .replace(/\$$/, '')
    .replace(/\\\//g, '/');
  let ki = 0;
  path = path.replace(/\(\?:\(\[\^\/\]\+\?\)\)/g, () => ':' + (keys[ki++]?.name ?? 'param'));
  path = path.replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, () => ':' + (keys[ki++]?.name ?? 'param'));
  return path.replace(/\/\?$/, '');
}

/** Walks the full router stack and collects every terminal route. */
function discoverRoutes(app: Application): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];

  function walk(stack: any[], prefix: string): void {
    for (const layer of stack) {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods).filter((m) => m !== '_all');
        const hasRateLimiter = layer.route.stack.some((s: any) => isRateLimiter(s.handle));
        for (const method of methods) {
          routes.push({
            method: method.toUpperCase(),
            path: prefix + layer.route.path,
            hasRateLimiter,
          });
        }
      }
      else if (layer.name === 'router' && layer.handle?.stack) {
        walk(layer.handle.stack, prefix + reconstructMountPath(layer));
      }
    }
  }

  walk((app as any)._router.stack, '');
  return routes;
}

interface BuiltApp {
  app: Application;
  /** Stops domain-level timers (funding scheduled jobs) started during init. */
  teardown: () => void;
}

/**
 * Builds the fully-assembled application, mirroring the domain wiring order in
 * src/server/server.ts but skipping database initialization and `app.listen`.
 * Route installation does not touch the database; the sqlite test dialect also
 * skips the housekeeping job-queue wiring. This produces the real router stack.
 *
 * Returns a `teardown` that stops the funding domain's scheduled-job timers,
 * which `FundingDomain.initialize` starts unconditionally. Without it those
 * timers leak for the life of the worker.
 */
async function buildFullApp(): Promise<BuiltApp> {
  const app: Application = express();
  const eventBus = new EventEmitter();

  const configurationDomain = new ConfigurationDomain(eventBus);
  configurationDomain.initialize(app);

  const setupDomain = new SetupDomain(configurationDomain.interface);
  setupDomain.initialize(app);

  const emailDomain = new EmailDomain();

  const accountsDomain = new AccountsDomain(
    eventBus, configurationDomain.interface, setupDomain.interface, emailDomain.interface,
  );
  accountsDomain.initialize(app);

  const authenticationDomain = new AuthenticationDomain(
    eventBus, accountsDomain.interface, emailDomain.interface,
  );
  authenticationDomain.initialize(app);

  const fundingDomain = new FundingDomain(eventBus);
  fundingDomain.initialize(app);

  const calendarDomain = new CalendarDomain(
    eventBus, accountsDomain.interface, emailDomain.interface, fundingDomain.interface,
  );
  calendarDomain.initialize(app);
  fundingDomain.setCalendarInterface(calendarDomain.interface);

  const moderationDomain = new ModerationDomain(
    eventBus, calendarDomain.interface, accountsDomain.interface,
    emailDomain.interface, configurationDomain.interface,
  );
  moderationDomain.initialize(app);
  calendarDomain.interface.setModerationInterface(moderationDomain.interface);

  const housekeepingDomain = new HousekeepingDomain(
    eventBus, emailDomain.interface, accountsDomain.interface,
  );
  await housekeepingDomain.initialize(app);

  const activityPubDomain = new ActivityPubDomain(
    eventBus, calendarDomain.interface, accountsDomain.interface,
    housekeepingDomain.interface, moderationDomain.interface,
  );
  activityPubDomain.initialize(app);
  calendarDomain.interface.setActivityPubInterface(activityPubDomain.interface);

  new NotificationsDomain(eventBus, calendarDomain.interface, accountsDomain.interface).initialize(app);
  accountsDomain.interface.setCalendarInterface(calendarDomain.interface);

  const publicDomain = new PublicCalendarDomain(eventBus, calendarDomain);
  publicDomain.initialize(app);

  const mediaDomain = new MediaDomain(eventBus, calendarDomain.interface);
  mediaDomain.initialize(app);
  calendarDomain.interface.setMediaInterface(mediaDomain.interface);

  return {
    app,
    teardown: () => fundingDomain.shutdown(),
  };
}

function routeKey(r: { method: string; path: string }): string {
  return `${r.method} ${r.path}`;
}

describe('rate-limit coverage guard', () => {
  let routes: DiscoveredRoute[];
  let teardown: () => void;

  beforeAll(async () => {
    const built = await buildFullApp();
    teardown = built.teardown;
    routes = discoverRoutes(built.app);
  });

  afterAll(() => {
    // Stop the funding domain's scheduled-job timers started during init.
    teardown();
    // The AP limiters share process-global singleton stores. Reset them (which
    // also destroys their cleanup-interval timers) so this suite leaves no live
    // handles for any test sharing the worker.
    resetActorRateLimitStore();
    resetCalendarRateLimitStore();
    resetUserRateLimitStore();
  });

  it('discovers a non-trivial route surface (introspection sanity check)', () => {
    expect(routes.length).toBeGreaterThan(50);
    const mutating = routes.filter((r) => MUTATING_METHODS.has(r.method));
    expect(mutating.length).toBeGreaterThan(20);

    // Positive-path reconstruction check. POST /api/v1/register is a known,
    // stably-registered route under a nested router (accounts domain). If
    // reconstructMountPath breaks (e.g. an Express major bump changes the
    // internal regexp encoding), this exact full path will fail to reconstruct
    // and this assertion fails with a clear "path reconstruction failed" signal
    // — instead of the breakage surfacing downstream as misleading "route not
    // found" / "unclassified route" errors in the guards below.
    expect(
      routes.some((r) => r.method === 'POST' && r.path === '/api/v1/register'),
      'Router introspection failed to reconstruct the known route POST /api/v1/register. '
        + 'reconstructMountPath likely broke against the installed Express version '
        + '(validated against Express 4.x) — fix path reconstruction before trusting the guards below.',
    ).toBe(true);
  });

  describe('regression guard: high-abuse-risk routes carry a rate-limit middleware', () => {
    it.each(HIGH_ABUSE_RISK_ROUTES)('$method $path is rate-limited', ({ method, path }) => {
      const match = routes.find((r) => r.method === method && r.path === path);
      expect(
        match,
        `High-abuse-risk route ${method} ${path} is not registered. The route was renamed or removed; update HIGH_ABUSE_RISK_ROUTES in this file to match.`,
      ).toBeDefined();
      expect(
        match!.hasRateLimiter,
        `High-abuse-risk route ${method} ${path} has NO rate-limit middleware. A limiter was removed from a high-value abuse surface. Re-attach a rate limiter (see src/server/common/middleware/rate-limiters.ts or the AP inbox limiters) before merging.`,
      ).toBe(true);
    });
  });

  describe('completeness guard: every mutating route is classified', () => {
    it('no mutating route is left unclassified', () => {
      const highRiskKeys = new Set(HIGH_ABUSE_RISK_ROUTES.map(routeKey));
      const allowListKeys = new Set(REVIEWED_NO_LIMITER_ROUTES.map(routeKey));

      const mutating = routes.filter((r) => MUTATING_METHODS.has(r.method));
      const unclassified = mutating.filter(
        (r) => !highRiskKeys.has(routeKey(r)) && !allowListKeys.has(routeKey(r)),
      );

      // De-duplicate (a route may appear once per registered method alias).
      const unique = Array.from(new Set(unclassified.map(routeKey))).sort();

      expect(
        unique,
        [
          'Unclassified mutating route(s) detected. Every POST/PUT/PATCH/DELETE route must be',
          'classified in src/server/common/test/rate-limit-coverage.test.ts. For each route below,',
          'either (A) attach a rate-limit middleware and add it to HIGH_ABUSE_RISK_ROUTES if it is a',
          'high-value abuse surface, or (B) add it to REVIEWED_NO_LIMITER_ROUTES with a one-line',
          'rationale after a deliberate review. See the MAINTENANCE PROTOCOL docblock at the top of',
          'the file.\n\nUnclassified:\n  ' + unique.join('\n  '),
        ].join(' '),
      ).toEqual([]);
    });

    it('the allow-list contains no stale entries (every entry maps to a real route)', () => {
      const mutatingKeys = new Set(
        routes.filter((r) => MUTATING_METHODS.has(r.method)).map(routeKey),
      );
      const stale = REVIEWED_NO_LIMITER_ROUTES
        .map(routeKey)
        .filter((k) => !mutatingKeys.has(k))
        .sort();

      expect(
        stale,
        'Stale allow-list entries: these routes are in REVIEWED_NO_LIMITER_ROUTES but no longer exist on the router. Remove them.\n  ' + stale.join('\n  '),
      ).toEqual([]);
    });

    it('no route is both high-risk and allow-listed (lists are disjoint)', () => {
      const allowListKeys = new Set(REVIEWED_NO_LIMITER_ROUTES.map(routeKey));
      const overlap = HIGH_ABUSE_RISK_ROUTES.map(routeKey).filter((k) => allowListKeys.has(k));
      expect(overlap, 'Routes appear on both HIGH_ABUSE_RISK_ROUTES and REVIEWED_NO_LIMITER_ROUTES: ' + overlap.join(', ')).toEqual([]);
    });
  });
});
