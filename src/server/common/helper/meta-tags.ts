/**
 * Meta-tags helper: URL parser and OG/Twitter Card data builder.
 *
 * NOTE: This is intentionally the only helper in server/common that depends on
 * a domain-level interface (PublicCalendarInterface). The dependency is injected
 * at runtime via the PublicInterfaceHolder pattern so that the helper remains
 * testable and the coupling is explicit. This design was chosen because meta-tag
 * generation requires cross-domain data (calendar + event + configuration) and
 * the alternative -- duplicating the logic inside a domain -- would scatter
 * presentation concerns across domain boundaries.
 */

import PublicCalendarInterface from '@/server/public/interface/index';
import { DEFAULT_LANGUAGE_CODE, getDefaultEnabledLanguageCodes } from '@/common/i18n/languages';
import { stripLocalePrefix } from '@/common/i18n/locale-url';
import { isReservedRouteSegment } from '@/common/routing/reserved-segments';
import { INSTANCE_SLUG_PATTERN, parseInstanceSlug } from '@/common/utils/instance-slug';
import { createLogger } from '@/server/common/helper/logger';
import { looksLikeUuid } from '@/server/common/helper/uuid';

const logger = createLogger('meta-tags');

/**
 * Mutable holder for the public calendar interface reference.
 * Set once during app bootstrap; consumed by buildEventMetaTags.
 */
export type PublicInterfaceHolder = { current: PublicCalendarInterface | null };

/**
 * Data structure returned by buildEventMetaTags for rendering OG/Twitter meta tags.
 */
export interface MetaTagData {
  title: string;
  description: string;
  image: string | null;
  url: string;
  type: string;
  siteName: string;
}

/**
 * Parsed parameters from a public event page URL.
 */
export interface EventPageParams {
  calendarUrlName: string;
  eventId: string;
  /**
   * The UTC yyyymmdd-hhmm instance slug when the path addresses a specific
   * occurrence. See @/common/utils/instance-slug for format details.
   */
  instanceStartTime?: string;
}

/**
 * Regex for public event page paths, applied after any locale prefix is removed.
 *
 * Per DEC-018 a calendar occupies a root segment, so the pattern anchors on the
 * calendar name itself rather than on a namespace prefix. It is deliberately
 * locale-free: `/:calendar/events/:id` and `/:lang/:calendar/events/:id` are the
 * same shape with an optional leading segment, and no regex can tell a locale
 * from a two-letter calendar name. parseEventPageParams resolves that with
 * stripLocalePrefix, which validates the code against the supported languages.
 *
 * Segment length caps defend against pathological URLs reaching the lookup
 * layer: calendarUrlName capped at 64 chars (matches calendar.url_name column
 * limit), eventId capped at 36 chars (UUID length, with the shape itself checked
 * in parseEventPageParams). The instance segment, when present, must match
 * INSTANCE_SLUG_PATTERN exactly, so the SSR parser and the site router agree on
 * which paths carry an occurrence.
 *
 * A single trailing slash is accepted. The site SPA's router is not in strict
 * mode, so `/cal/events/:id/` renders the event page; rejecting it here would
 * serve that page with no meta tags at all -- silent degradation on a link shape
 * that copy-paste and link builders produce routinely. The canonical URL built
 * downstream is always the slash-free form, so the two spellings converge.
 */
const EVENT_PAGE_RE = new RegExp(`^/([^/]{1,64})/events/([^/]{1,36})(?:/(${INSTANCE_SLUG_PATTERN}))?/?$`, 'i');

/**
 * Parses a public event page URL path into its component parts.
 *
 * Supports paths with or without a locale prefix and with or without
 * a timestamp-slug instance segment:
 *   /:calendar/events/:eventId
 *   /:calendar/events/:eventId/:yyyymmdd-hhmm
 *   /fr/:calendar/events/:eventId
 *   /fr/:calendar/events/:eventId/:yyyymmdd-hhmm
 *
 * The retired /view/ shape (DEC-018) does not match; the server redirects those
 * paths before a page is ever rendered for them.
 *
 * Two ordering rules matter here:
 *
 * 1. The locale prefix is stripped *before* the reservation check, because
 *    isReservedRouteSegment answers true for locale codes as well as for the
 *    literal reserved segments -- checking first would reject every /fr/... path.
 * 2. The reservation check is a routing disposition, not name validation. It
 *    keeps /api/events/x and /admin/events/x from resolving as event pages, and
 *    mirrors the server route table's exclusions so SSR meta tags agree with
 *    whatever the router would have served. It is not the DEC-018 rule-4
 *    lookup gate: calendar resolution still happens in getCalendarByName on the
 *    shape rule alone.
 *
 * At most one locale prefix is removed, so the caller must pass a path that has
 * not already been stripped -- `req.path`, not a pre-stripped remainder. Two
 * strips over `/fr/es/cal/events/:id` would yield `cal`'s event page, and a
 * once-stripped path is indistinguishable here from a legitimate `/es/cal/...`,
 * so the contract cannot be enforced from inside this function.
 *
 * Percent-encoding is deliberately not decoded, matching Express, which matches
 * routes on the raw pathname. `/%61dmin/events/:id` therefore parses -- the
 * reservation check does not fire on the encoded spelling and this function
 * returns `calendarUrlName: '%61dmin'` verbatim. What makes that harmless is one
 * layer up, not here: buildEventMetaTags hands the name to getCalendarByName,
 * which gates on CALENDAR_URL_NAME_RE and returns null before issuing a query,
 * so the request emits no meta tags and reaches no row. That regex in
 * src/server/calendar/service/calendar.ts is load-bearing for this argument;
 * both halves are pinned by tests.
 *
 * @param path - The URL path to parse; pass req.path, not a locale-stripped path
 * @returns Parsed parameters or null if the path does not match
 */
export function parseEventPageParams(path: string): EventPageParams | null {
  const { path: unprefixedPath } = stripLocalePrefix(path);

  const match = unprefixedPath.match(EVENT_PAGE_RE);
  if (!match) {
    return null;
  }

  const calendarUrlName = match[1];
  if (isReservedRouteSegment(calendarUrlName)) {
    return null;
  }

  // The event id addresses a uuid column. Without a shape check a junk id
  // reaches Postgres as `where: { id: 'zzzz' }`, which raises and unwinds to the
  // warn-and-degrade handler in buildEventMetaTags -- one DB error and one log
  // line per request, on a route with no rate limiter. looksLikeUuid rather than
  // isValidUuidV4: this guards a column, and an id minted by a federated peer
  // need not carry v4 bits.
  const eventId = match[2];
  if (!looksLikeUuid(eventId)) {
    return null;
  }

  const result: EventPageParams = {
    calendarUrlName,
    eventId,
  };

  if (match[3]) {
    result.instanceStartTime = match[3];
  }

  return result;
}

/**
 * Decodes common HTML entities to their character equivalents.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ');
}

/**
 * Strips all HTML tags from a string.
 */
function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}

/**
 * Sanitizes a description string for use in meta tags.
 *
 * Process: decode HTML entities -> strip HTML tags -> trim whitespace ->
 * truncate to 200 characters with ellipsis.
 *
 * @param raw - The raw description string (may contain HTML)
 * @returns Sanitized plain-text description
 */
function sanitizeDescription(raw: string): string {
  const decoded = decodeHtmlEntities(raw);
  const stripped = stripHtmlTags(decoded);
  const trimmed = stripped.trim();

  if (trimmed.length <= 200) {
    return trimmed;
  }
  return trimmed.slice(0, 200) + '...';
}

/**
 * Resolves the best available content locale for a translated model.
 *
 * Validates the requested locale against enabled language codes, falling back
 * to the default language code. If the model has no content for the resolved
 * locale, falls back to the first available language that has content.
 *
 * This is a row selector: the caller reads the name and description off the
 * row for the locale returned here. `hasContentFn` is therefore always the
 * model's `hasContent`, which selects on the fields a row consumer renders
 * rather than on "does this row hold anything at all" — a language whose row
 * carries only alt text is skipped rather than resolved to and rendered as an
 * empty title. See `TranslatedContentModel.hasDisplayContent`.
 *
 * @param hasContentFn - Function to check if content exists for a locale
 * @param getLanguagesFn - Function to get all available content languages
 * @param requestedLocale - The locale requested by the client
 * @returns The best available locale string, or null if no content exists
 */
function resolveContentLocale(
  hasContentFn: (lang: string) => boolean,
  getLanguagesFn: () => string[],
  requestedLocale: string,
): string | null {
  const enabledCodes = getDefaultEnabledLanguageCodes();

  // Validate requested locale; fall back to default
  const locale = enabledCodes.includes(requestedLocale)
    ? requestedLocale
    : DEFAULT_LANGUAGE_CODE;

  if (hasContentFn(locale)) {
    return locale;
  }

  // Fall back to the first available language that carries display content.
  // `getLanguagesFn` lists every stored row, including ones holding only alt
  // text, so the same `hasContentFn` check the requested locale went through is
  // applied here too — otherwise the fallback reintroduces exactly the blank
  // title and description that check exists to avoid.
  const available = getLanguagesFn();
  const usable = available.find(lang => hasContentFn(lang));
  if (usable) {
    return usable;
  }

  return null;
}

/**
 * Builds OpenGraph/Twitter Card meta tag data for a public event page.
 *
 * Fetches the calendar and event (or event instance) via the public interface,
 * resolves the best locale for content, sanitizes the description, resolves
 * the image URL, and constructs the canonical URL.
 *
 * Wrapped in a 2-second timeout and try/catch -- returns null on any failure
 * so that pages degrade gracefully to no meta tags rather than erroring.
 *
 * @param publicInterface - Holder containing the public calendar interface
 * @param params - Parsed event page parameters from parseEventPageParams
 * @param locale - Requested locale for content resolution
 * @param baseUrl - Base URL of the instance (e.g. https://example.com)
 * @returns MetaTagData object or null on failure/timeout
 */
export async function buildEventMetaTags(
  publicInterface: PublicInterfaceHolder,
  params: EventPageParams,
  locale: string,
  baseUrl: string,
): Promise<MetaTagData | null> {
  const TIMEOUT_MS = 2000;

  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      buildMetaTagsInternal(publicInterface, params, locale, baseUrl),
      timeoutPromise,
    ]);
  }
  catch (err) {
    logger.warn({ err, params }, 'Failed to build event meta tags');
    return null;
  }
}

/**
 * Internal implementation of meta tag building (without timeout wrapper).
 */
async function buildMetaTagsInternal(
  publicInterface: PublicInterfaceHolder,
  params: EventPageParams,
  locale: string,
  baseUrl: string,
): Promise<MetaTagData | null> {
  if (!publicInterface.current) {
    logger.warn('Public interface not initialized');
    return null;
  }

  const iface = publicInterface.current;

  // Fetch calendar
  const calendar = await iface.getCalendarByName(params.calendarUrlName);
  if (!calendar) {
    return null;
  }

  // Fetch event or instance
  let event;
  if (params.instanceStartTime) {
    const startTime = parseInstanceSlug(params.instanceStartTime);
    if (!startTime) {
      return null;
    }
    const instance = await iface.findOrMaterializeInstanceWithDetails(
      params.eventId,
      startTime,
    );
    if (!instance) {
      return null;
    }
    event = instance.event;
  }
  else {
    event = await iface.getEventById(params.eventId);
    if (!event) {
      return null;
    }
  }

  // Resolve content locale
  const resolvedLocale = resolveContentLocale(
    (lang) => event.hasContent(lang),
    () => event.getLanguages(),
    locale,
  );

  // Build title and description
  let title = '';
  let description = '';

  if (resolvedLocale) {
    const eventContent = event.content(resolvedLocale);
    title = eventContent.name || '';
    description = eventContent.description || '';
  }

  // Sanitize description
  const sanitizedDescription = sanitizeDescription(description);

  // Resolve site name from calendar content
  let siteName = '';
  const calendarLocale = resolveContentLocale(
    (lang) => calendar.hasContent(lang),
    () => calendar.getLanguages(),
    locale,
  );
  if (calendarLocale) {
    siteName = calendar.content(calendarLocale).name || '';
  }

  // Resolve image URL: event media -> calendar default image -> null
  let image: string | null = null;
  if (event.media?.id) {
    image = `${baseUrl}/api/v1/media/${event.media.id}`;
  }
  else if (calendar.defaultEventImage?.id) {
    image = `${baseUrl}/api/v1/media/${calendar.defaultEventImage.id}`;
  }

  // Build canonical URL. DEC-018 addresses a calendar at the domain root, and
  // the canonical form carries no locale prefix regardless of the requested one.
  const canonicalPath = params.instanceStartTime
    ? `/${params.calendarUrlName}/events/${params.eventId}/${params.instanceStartTime}`
    : `/${params.calendarUrlName}/events/${params.eventId}`;
  const url = `${baseUrl}${canonicalPath}`;

  return {
    title,
    description: sanitizedDescription,
    image,
    url,
    type: 'article',
    siteName,
  };
}
