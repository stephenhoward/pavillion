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
import { createLogger } from '@/server/common/helper/logger';

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
interface EventPageParams {
  calendarUrlName: string;
  eventId: string;
  instanceId?: string;
}

/** Regex for public event page paths, with optional locale prefix. */
const EVENT_PAGE_RE = /^(?:\/[a-z]{2,8})?\/view\/([^/]+)\/events\/([^/]+)(?:\/([^/]+))?$/i;

/**
 * Parses a public event page URL path into its component parts.
 *
 * Supports paths with or without a locale prefix and with or without
 * an instance ID segment:
 *   /view/:calendar/events/:eventId
 *   /view/:calendar/events/:eventId/:instanceId
 *   /fr/view/:calendar/events/:eventId
 *   /fr/view/:calendar/events/:eventId/:instanceId
 *
 * @param path - The URL path to parse (e.g. from req.path)
 * @returns Parsed parameters or null if the path does not match
 */
export function parseEventPageParams(path: string): EventPageParams | null {
  const match = path.match(EVENT_PAGE_RE);
  if (!match) {
    return null;
  }

  const result: EventPageParams = {
    calendarUrlName: match[1],
    eventId: match[2],
  };

  if (match[3]) {
    result.instanceId = match[3];
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
 * locale, falls back to the first available language.
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

  // Fall back to first available language
  const available = getLanguagesFn();
  if (available.length > 0) {
    return available[0];
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
  if (params.instanceId) {
    const instance = await iface.getEventInstanceById(params.instanceId);
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

  // Build canonical URL
  const canonicalPath = params.instanceId
    ? `/view/${params.calendarUrlName}/events/${params.eventId}/${params.instanceId}`
    : `/view/${params.calendarUrlName}/events/${params.eventId}`;
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
