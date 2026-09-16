/**
 * The public URL shapes, as root-relative paths.
 *
 * DEC-018 put public calendar pages at the domain root, which spread one path
 * shape across three consumers: the server (absolute links in emails, API
 * payloads and federation-facing fields), the client SPA (the shareable address
 * shown to an organizer) and the site SPA (its own internal links). Each one
 * used to template the shape inline, which is how `/view/…` survived in a
 * `<RouterLink>` long after the routes moved (8f47ac27). These builders are
 * the single declaration of that shape, and all three consumers are now on
 * them — the client SPA only indirectly for a calendar's address, which it
 * renders from the server-stamped `Calendar.publicUrl` so the link an
 * organizer copies and the text they read cannot disagree. Two server
 * generators stay outside this module rather than being folded in:
 *
 * - `src/server/activitypub/model/userprofile.ts` builds the actor
 *   document's `url` alongside three sibling URIs (`id`, `inbox`, `outbox`)
 *   that address the `/calendars/:urlName/...` AP-protocol namespace, which
 *   this module doesn't model at all. `url` is the only one of the four that
 *   happens to want the public-page shape, and this module only emits
 *   root-relative paths (see "Origin" below), so using it here would still
 *   mean hand-concatenating the origin — no less hand-rolling than today,
 *   applied to one field out of four.
 * - `src/server/common/helper/meta-tags.ts` builds the SSR canonical/og:url
 *   path by echoing back segments `parseEventPageParams` captured from the
 *   raw request path, which — per that function's own doc — are matched
 *   pre-decode and may already be percent-encoded. Routing them through
 *   `eventPath` would percent-encode them a second time.
 *
 * Deliberately NOT here:
 *
 * - **Locale.** The prefix is the site SPA's concern; `useLocale.localizedPath`
 *   wraps a path from this module when the page is locale-prefixed. Baking it
 *   in would force every server caller — none of which is locale-aware — to
 *   pass a locale it does not have.
 * - **Origin.** A server caller prepends `https://{config.domain}`; a browser
 *   caller uses the path as-is. A builder that emitted an absolute URL would
 *   have to read configuration, which is what keeps this module importable from
 *   all three sides.
 * - **A peer's pages.** These builders describe OUR route shape only. Never
 *   template one onto a remote host: `src/server/calendar/helper/source_calendar.ts`
 *   explains why a peer's page URL comes from the peer's own actor document,
 *   and why the retired `/view/` spelling is the safer guess when we have none.
 *
 * The route table these shapes must agree with is `buildSiteRoutes` in
 * src/site/routes.ts; src/common/test/routing/public-url-contract.test.ts joins
 * the two so a divergence fails rather than rendering chrome with no content.
 *
 * Every dynamic segment is percent-encoded. Calendar and series url names are
 * already URL-safe by construction (`CALENDAR_URL_NAME_RE`) and event ids are
 * UUIDs, so encoding is a no-op on every valid input — it is here so a value
 * that reached a builder unvalidated cannot inject a path separator into a link
 * rendered on an anonymous public page.
 */

/** The public discovery page — the index of listed calendars. */
export const DISCOVER_PATH = '/discover';

/**
 * The public page for one calendar.
 *
 * @param urlName - The calendar's url name
 * @returns A root-relative path, with no locale prefix and no origin
 */
export function calendarPath(urlName: string): string {
  return `/${encodeURIComponent(urlName)}`;
}

/**
 * The public page for one event, or for one occurrence of a recurring event.
 *
 * @param urlName - The owning calendar's url name
 * @param eventId - The event's id
 * @param instanceSlug - A single occurrence's start time, as the
 *   `YYYYMMDD-HHmm` slug the site route matches. Omitted or empty yields the
 *   event's own page.
 * @returns A root-relative path, with no locale prefix and no origin
 */
export function eventPath(urlName: string, eventId: string, instanceSlug?: string): string {
  const eventUrl = `${calendarPath(urlName)}/events/${encodeURIComponent(eventId)}`;

  if (instanceSlug === undefined || instanceSlug === '') {
    return eventUrl;
  }
  return `${eventUrl}/${encodeURIComponent(instanceSlug)}`;
}

/**
 * The public page for one event series.
 *
 * @param urlName - The owning calendar's url name
 * @param seriesUrlName - The series' url name
 * @returns A root-relative path, with no locale prefix and no origin
 */
export function seriesPath(urlName: string, seriesUrlName: string): string {
  return `${calendarPath(urlName)}/series/${encodeURIComponent(seriesUrlName)}`;
}
