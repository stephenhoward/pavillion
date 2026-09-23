import { RouteRecordRaw, RouterScrollBehavior } from 'vue-router';

import { AVAILABLE_LANGUAGES, DEFAULT_LANGUAGE_CODE } from '@/common/i18n/languages';
import { DISCOVER_PATH } from '@/common/routing/public-paths';

/**
 * Whatever vue-router accepts as a route's `component`.
 *
 * Derived from RouteRecordRaw rather than imported from 'vue' as `Component`,
 * so this module needs no dependency on Vue itself.
 */
type SiteRouteComponent = NonNullable<RouteRecordRaw['component']>;

/**
 * The view components the site route table binds, one per page shape.
 *
 * The table is built by a factory rather than exported as a ready-made array so
 * the thing under test can be the PATH table on its own: a routing test passes
 * stub components and never drags in the calendar/event component graph, its
 * Pinia stores or its services, while src/site/app.ts passes the real views.
 */
export interface SiteRouteComponents {
  discovery: SiteRouteComponent;
  calendar: SiteRouteComponent;
  event: SiteRouteComponent;
  instance: SiteRouteComponent;
  series: SiteRouteComponent;
}

/**
 * Builds the public site's route table — the single declaration of which paths
 * the site SPA can match.
 *
 * Calendars live at the domain root. DISCOVER_PATH is a static segment, which
 * vue-router ranks above the '/:calendar' param regardless of declaration
 * order, so the discovery page is never swallowed by the calendar route —
 * and 'discover' is a reserved url name (src/common/routing/reserved-segments.ts)
 * so no calendar can claim it in the other direction either. It is read from
 * src/common/routing/public-paths.ts rather than spelled again, so the segment
 * every link generator emits and the segment this table matches cannot drift.
 * The parameterized shapes below cannot be sourced the same way — a builder
 * emits a concrete path, not a ':param' template — so the contract test joins
 * the builders' output to this table instead.
 *
 * The locale alternation is derived from AVAILABLE_LANGUAGES minus the default
 * code, never hard-coded, so enabling a language adds its prefixed routes here
 * and in the server's page regexes from the same source.
 * src/common/test/routing/public-url-contract.test.ts joins the two.
 *
 * @param components - The view component to bind to each page shape
 * @returns The site route records, unprefixed shapes first
 */
export function buildSiteRoutes(components: SiteRouteComponents): RouteRecordRaw[] {
  const routes: RouteRecordRaw[] = [
    { path: DISCOVER_PATH, component: components.discovery, name: 'discovery' },
    { path: '/:calendar', component: components.calendar, name: 'calendar' },
    { path: '/:calendar/events/:event', component: components.event, name: 'event' },
    { path: '/:calendar/events/:event/:startTime(\\d{8}-\\d{4})', component: components.instance, name: 'instance' },
    { path: '/:calendar/series/:series', component: components.series, name: 'series' },
  ];

  const nonDefaultLocales = AVAILABLE_LANGUAGES
    .filter(lang => lang.code !== DEFAULT_LANGUAGE_CODE)
    .map(lang => lang.code);

  if (nonDefaultLocales.length > 0) {
    const pattern = nonDefaultLocales.join('|');
    // Locale-prefixed variants — unnamed intentionally.
    // Navigation uses the default-locale named routes; useLocale.localizedPath() adds the prefix.
    routes.push(
      { path: `/:locale(${pattern})${DISCOVER_PATH}`, component: components.discovery },
      { path: `/:locale(${pattern})/:calendar`, component: components.calendar },
      { path: `/:locale(${pattern})/:calendar/events/:event`, component: components.event },
      { path: `/:locale(${pattern})/:calendar/events/:event/:startTime(\\d{8}-\\d{4})`, component: components.instance },
      { path: `/:locale(${pattern})/:calendar/series/:series`, component: components.series },
    );
  }

  return routes;
}

/**
 * Where the site's window scroll lands after an in-SPA navigation.
 *
 * Without this, vue-router leaves the window scrolled where it was, so a card
 * clicked halfway down a calendar would open its event page halfway down too —
 * unlike the full-document navigation those links used to perform, which
 * always started at the top. The rule reproduces that without disturbing
 * navigations that only re-parameterise the page already on screen:
 *
 * - Back/forward restores the position the browser saved for that entry.
 * - Arriving at a different view (calendar → event, discovery → calendar)
 *   starts at the top, as a fresh page load would.
 * - Staying on the same view (filter changes rewriting the query, a locale
 *   switch swapping the prefix) keeps the reader's place.
 *
 * @returns The saved position, the top of the page, or false to leave scroll alone
 */
export const siteScrollBehavior: RouterScrollBehavior = (to, from, savedPosition) => {
  if (savedPosition) {
    return savedPosition;
  }

  const toView = to.matched[0]?.components?.default;
  const fromView = from.matched[0]?.components?.default;
  if (toView !== fromView) {
    return { top: 0 };
  }

  return false;
};
