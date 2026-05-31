/**
 * Public-docs surfacing: maps in-app routes to relevant guides on
 * https://docs.pavillion.social and builds canonical URLs to them.
 *
 * The `key` field is an indirection into `system.help.guides.*` i18n keys
 * rather than an inline label/description — this keeps user-visible strings
 * in the locale files and lets one guide be referenced from multiple routes
 * without duplicating its label.
 */

export const DOCS_BASE = 'https://docs.pavillion.social';

export type Audience = 'calendar-owners' | 'instance-administrators';

export type GuideRef = {
  /** Slug relative to DOCS_BASE — no leading slash, no `.html` (docs site uses `cleanUrls`). */
  slug: string;
  /** Leaf key under `system:help.guides.*` providing `label` and `description`. */
  key: string;
};

/** Builds a fully qualified URL on docs.pavillion.social for the given slug. */
export function docsUrl(slug: string): string {
  return `${DOCS_BASE}/${slug}`;
}

/** URL for the top-level audience landing page on the docs site. */
export function browseAllUrl(audience: Audience): string {
  return docsUrl(`guides/${audience}`);
}

/**
 * Route name → ordered list of relevant guides (most relevant first).
 * Keyed by Vue Router route name so the mapping survives URL refactors.
 * Routes not listed here intentionally have no help affordance.
 */
export const ROUTE_GUIDES: Record<string, GuideRef[]> = {
  // Calendar-owner surfaces
  calendars: [
    { slug: 'guides/calendar-owners/quickstart', key: 'quickstart' },
    { slug: 'guides/calendar-owners/when-to-create-a-calendar', key: 'when_to_create' },
  ],
  calendar: [
    { slug: 'guides/calendar-owners/public-url', key: 'public_url' },
    { slug: 'guides/calendar-owners/embed', key: 'embed' },
  ],
  calendar_management: [
    { slug: 'guides/calendar-owners/editors', key: 'editors' },
    { slug: 'guides/calendar-owners/identity', key: 'identity' },
    { slug: 'guides/calendar-owners/federation-etiquette', key: 'federation_etiquette' },
    { slug: 'guides/calendar-owners/ics-import', key: 'ics_import' },
  ],
  event_new: [
    { slug: 'guides/calendar-owners/recurring-events', key: 'recurring' },
    { slug: 'guides/calendar-owners/categories', key: 'categories' },
    { slug: 'guides/calendar-owners/multilingual', key: 'multilingual' },
  ],
  event_edit: [
    { slug: 'guides/calendar-owners/cancel-event', key: 'cancel' },
    { slug: 'guides/calendar-owners/series', key: 'series' },
    { slug: 'guides/calendar-owners/recurring-events', key: 'recurring' },
  ],
  place_new: [
    { slug: 'guides/calendar-owners/places', key: 'places' },
  ],
  place_edit: [
    { slug: 'guides/calendar-owners/places', key: 'places' },
  ],
  feed: [
    { slug: 'guides/calendar-owners/follow-and-repost', key: 'follow_repost' },
  ],
  calendar_category_mappings: [
    { slug: 'guides/calendar-owners/category-matching', key: 'category_matching' },
  ],
  funding_plan: [
    { slug: 'guides/calendar-owners/funding', key: 'funding_owner' },
  ],
  inbox: [
    { slug: 'guides/calendar-owners/moderation', key: 'moderation_owner' },
  ],
  profile: [
    { slug: 'guides/calendar-owners/account', key: 'account' },
  ],

  // Instance-administrator surfaces
  admin_settings: [
    { slug: 'guides/instance-administrators/configuration', key: 'admin_config' },
    { slug: 'guides/instance-administrators/being-a-good-admin', key: 'good_admin' },
  ],
  accounts: [
    { slug: 'guides/instance-administrators/accounts', key: 'admin_accounts' },
    { slug: 'guides/instance-administrators/who-gets-a-calendar', key: 'who_gets' },
  ],
  admin_calendars: [
    { slug: 'guides/instance-administrators/removing-a-calendar', key: 'removing' },
    { slug: 'guides/instance-administrators/communicating-with-calendar-owners', key: 'communicating' },
  ],
  moderation: [
    { slug: 'guides/instance-administrators/moderation-boundaries', key: 'mod_boundaries' },
  ],
  moderation_settings: [
    { slug: 'guides/instance-administrators/code-of-conduct', key: 'coc' },
  ],
  blocked_instances: [
    { slug: 'guides/instance-administrators/federation-incidents', key: 'fed_incidents' },
  ],
  federation: [
    { slug: 'guides/instance-administrators/how-federation-works-for-admins', key: 'how_fed_works' },
    { slug: 'guides/instance-administrators/federation-policy', key: 'fed_policy' },
  ],
  funding: [
    { slug: 'guides/instance-administrators/funding-plans-setup', key: 'funding_setup' },
    { slug: 'guides/instance-administrators/asking-your-community-for-money', key: 'asking' },
  ],
};

/**
 * Look up guides for a route by name. Returns an empty array for unknown
 * routes (typed-string mismatches) or non-string route names (e.g., symbol
 * route names from vue-router) so callers can safely render nothing.
 */
export function guidesForRoute(name: string | symbol | null | undefined): GuideRef[] {
  return typeof name === 'string' ? (ROUTE_GUIDES[name] ?? []) : [];
}

/**
 * Audience whose top-level landing page is most relevant for a route name.
 * Admin routes map to `instance-administrators`; everything else (including
 * unknown routes) maps to `calendar-owners`.
 */
export function audienceForRoute(name: string | symbol | null | undefined): Audience {
  if (typeof name !== 'string') return 'calendar-owners';
  return name in ADMIN_ROUTE_SET ? 'instance-administrators' : 'calendar-owners';
}

const ADMIN_ROUTE_SET: Record<string, true> = {
  admin_settings: true,
  accounts: true,
  admin_calendars: true,
  moderation: true,
  moderation_report_detail: true,
  moderation_settings: true,
  blocked_instances: true,
  federation: true,
  funding: true,
};
