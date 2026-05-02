import config from 'config';
import he from 'he';
import { DateTime } from 'luxon';
import striptags from 'striptags';

import { Calendar } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventSchedule, UrlPrompt, URL_PROMPT_VALUES } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';
import { ActivityPubObject } from '@/server/activitypub/model/base';
import { SeriesObject } from '@/server/activitypub/model/object/series';

/**
 * English fallback labels for URL prompt tokens. Emitted in the outbound AS
 * `attachment.name` so non-Pavillion peers (Mobilizon, Gancio) can render a
 * human-readable label. Pavillion peers round-trip the raw enum token via the
 * `pavillion:urlPrompt` extension field.
 */
const URL_PROMPT_EN_LABELS: Record<UrlPrompt, string> = {
  tickets: 'Tickets',
  rsvp: 'RSVP',
  more_info: 'More Information',
  register: 'Register',
};

/**
 * Strips HTML tags and decodes HTML entities from a string.
 */
function stripHtmlTags(html: string): string {
  return striptags(he.decode(html)).trim();
}

/**
 * Sanitizes an untrusted href value from a federated peer. Returns a parsed
 * http(s) URL string or null for any anomaly (non-string, empty/whitespace,
 * too long, malformed, or non-http(s) scheme).
 *
 * Security-critical: This is the authoritative barrier against malicious peers
 * injecting javascript:, data:, ftp:, or other dangerous URL schemes into
 * stored event data. NEVER throws — a throw would cause the inbox to reject
 * the entire activity, which is not the correct posture for a single bad field.
 */
function sanitizeExternalUrlHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.length > 2048) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  }
  catch {
    return null;
  }
}

class EventObject extends ActivityPubObject {
  type: string = 'Event';
  attributedTo: string;
  date: Date;
  location: LocationObject|string;
  parentEvent: string = '';
  childEvents: string[] = [];
  categories: string[] = [];
  series: string | null = null;
  content: Record<string, APEventContent>;
  schedules: CalendarEventSchedule[];

  private readonly _calendar: Calendar;
  private readonly _event: CalendarEvent;

  static eventUrl(calendar: Calendar, event: CalendarEvent|string ): string {
    let id = typeof event == 'string'
      ? event
      : event.id;

    return id.match('^https?:\/\/')
      ? id
      : 'https://'+config.get('domain')+'/calendars/'+calendar.urlName+'/events/'+id;
  }

  constructor( calendar: Calendar, event: CalendarEvent ) {
    super();
    this._calendar = calendar;
    this._event = event;
    this.id = EventObject.eventUrl(calendar,event);

    // Set attributedTo to the calendar's actor URL
    const domain = config.get('domain');
    this.attributedTo = 'https://'+domain+'/calendars/'+calendar.urlName;

    this.date = event.date;
    this.content = event.toObject().content;

    if( event.parentEvent ) {
      this.parentEvent = event.parentEvent.id;
    }

    // Serialize event categories as public API URIs
    if (event.categories && event.categories.length > 0) {
      this.categories = event.categories.map(cat =>
        `https://${domain}/api/public/v1/calendar/${calendar.urlName}/categories/${cat.id}`,
      );
    }

    // Serialize series as AP series Object ID (UUID-based URL)
    if (event.series) {
      this.series = SeriesObject.seriesUrl(calendar, event.series);
    }
  }

  /**
   * Serializes this event as a standard ActivityPub object with AS properties
   * and pavillion:* prefixed extensions for federation.
   *
   * @returns {Record<string, any>} ActivityPub-compatible object
   */
  toActivityPubObject(): Record<string, any> {
    const domain = config.get('domain');
    const event = this._event;
    const calendar = this._calendar;

    // Determine primary language: prefer 'en' if event has en content with a name,
    // otherwise use the first language with a non-empty name
    const primaryLanguage = event._content['en']?.name
      ? 'en'
      : Object.keys(event._content).find(l => event._content[l]?.name) || 'en';

    // Build name from primary language content, inlining fallback search
    const primaryContent = event._content[primaryLanguage];
    let name = primaryContent?.name || 'Untitled Event';
    if (name === 'Untitled Event') {
      for (const lang of Object.keys(event._content)) {
        const c = event._content[lang];
        if (c.name && c.name.trim().length > 0) {
          name = c.name;
          break;
        }
      }
    }

    // Build startTime from first schedule or fallback to date field
    const startTime = this._resolveStartTime(event);

    const result: Record<string, any> = {
      type: this.type,
      id: this.id,
      attributedTo: this.attributedTo,
      name,
      startTime,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`https://${domain}/calendars/${calendar.urlName}/followers`],
    };

    // published: when the event was originally created (AS 2.0 vocabulary)
    if (event.createdAt) {
      result.published = event.createdAt.toISOString();
    }

    // summary: only when primary-language description is non-empty
    const primaryDescription = primaryContent?.description || '';
    if (primaryDescription.trim().length > 0) {
      result.summary = primaryDescription;
      // content: HTML-wrapped description for interop (Mobilizon, Gancio, Friendica)
      result.content = `<p>${primaryDescription}</p>`;
    }

    // endTime: use eventEndTime if available, otherwise synthesize startTime + 1 hour
    const firstSchedule = event.schedules[0];
    const endDateTime = firstSchedule?.eventEndTime;
    if (endDateTime?.isValid) {
      result.endTime = endDateTime.toISO();
    }
    else {
      // Synthesize endTime = startTime + 1 hour; setZone preserves the original offset
      const synthesizedEnd = DateTime.fromISO(startTime, { setZone: true }).plus({ hours: 1 });
      if (synthesizedEnd.isValid) {
        result.endTime = synthesizedEnd.toISO();
      }
    }
    // location: emitted as Place with optional PostalAddress; omitted if no location
    const locationObj = this._buildLocation(event.location);
    if (locationObj) {
      result.location = locationObj;
    }

    // nameMap/summaryMap: only when 2+ languages have content
    const contentLanguages = Object.keys(event._content).filter(
      lang => event._content[lang] && !event._content[lang].isEmpty(),
    );
    if (contentLanguages.length >= 2) {
      const nameMap: Record<string, string> = {};
      const summaryMap: Record<string, string> = {};
      let hasSummaryEntries = false;

      for (const lang of contentLanguages) {
        const c = event._content[lang];
        if (c.name) {
          nameMap[lang] = c.name;
        }
        if (c.description) {
          summaryMap[lang] = c.description;
          hasSummaryEntries = true;
        }
      }

      if (Object.keys(nameMap).length > 0) {
        result.nameMap = nameMap;
      }
      if (hasSummaryEntries) {
        result.summaryMap = summaryMap;
        // contentMap: HTML-wrapped descriptions for interop (Mobilizon, Gancio, Friendica)
        const contentMap: Record<string, string> = {};
        for (const [lang, desc] of Object.entries(summaryMap)) {
          contentMap[lang] = `<p>${desc}</p>`;
        }
        result.contentMap = contentMap;
      }
    }

    // image: event's own media takes precedence, then calendar default; omit if neither exists
    const media = event.media ?? calendar.defaultEventImage;
    if (media && media.status === 'approved') {
      result.image = {
        type: 'Image',
        url: `https://${domain}/api/v1/media/${media.id}`,
        mediaType: media.mimeType,
      };
    }

    // attachment Link + pavillion:urlPrompt: emit only when BOTH fields are set.
    // Service-layer guard ensures externalUrl and urlPrompt are always set together.
    // The AS top-level `url` field is intentionally NOT overloaded — it is reserved
    // for the canonical event page (Mobilizon compatibility).
    if (event.externalUrl && event.urlPrompt) {
      result.attachment = [
        {
          type: 'Link',
          href: event.externalUrl,
          name: URL_PROMPT_EN_LABELS[event.urlPrompt],
          rel: 'external',
        },
      ];
      result['pavillion:urlPrompt'] = event.urlPrompt;
    }

    // pavillion:* extensions
    result['pavillion:content'] = event.toObject().content;
    result['pavillion:categories'] = this.categories;
    result['pavillion:series'] = this.series;
    result['pavillion:schedules'] = event.schedules.map(s => s.toObject());

    return result;
  }

  /**
   * Normalizes a raw ActivityPub event object into the internal eventParams shape
   * expected by CalendarEvent.fromObject(). Handles three formats:
   *
   * 1. New Pavillion format: pavillion:content, pavillion:categories, etc. take precedence
   * 2. Old Pavillion format: bare content, categories, schedules, series pass through
   * 3. Standard AS format: name/summary/nameMap/summaryMap mapped to content, startTime/endTime
   *    synthesized into schedules and date
   *
   * Note: This intentionally returns Record<string, any> (eventParams shape) rather than
   * a domain model instance. The caller (inbox.ts) spreads these params and then passes
   * them to CalendarEvent.fromObject() via the calendar service layer. This diverges from
   * the typical fromObject() pattern because the AP wire format does not map 1:1 to the
   * domain model constructor.
   *
   * @param apObject - Raw ActivityPub object from the wire
   * @param options - Optional parsing context. When `actorUri` is provided, it is
   *   used to origin-gate sensitive fields (currently `hideFromPublic` on schedules):
   *   only the source instance may set cancellation state, so payloads from actors
   *   whose domain differs from the event's origin domain have `hideFromPublic`
   *   stripped from every schedule entry. Omit `actorUri` for legacy callers or
   *   contexts where origin enforcement is handled elsewhere (e.g. calendar-actor
   *   Update activities that already reject on domain mismatch).
   * @returns eventParams shape compatible with CalendarEvent.fromObject()
   */
  static fromActivityPubObject(
    apObject: Record<string, any>,
    options: { actorUri?: string } = {},
  ): Record<string, any> {
    // Spread entire input first; subsequent normalization overwrites handled keys
    const result: Record<string, any> = Object.assign({}, apObject);

    // --- Content resolution ---
    // Priority: pavillion:content > bare content (old format) > name/summary/nameMap/summaryMap
    // All paths sanitize text fields — even pavillion:content from trusted instances,
    // since any remote instance can include this key in its AP payload.
    if (apObject['pavillion:content']) {
      result.content = EventObject._sanitizeContentObject(apObject['pavillion:content']);
    }
    else if (apObject.content && typeof apObject.content === 'object' && !Array.isArray(apObject.content)) {
      // Old Pavillion format: bare content object with language keys
      result.content = EventObject._sanitizeContentObject(apObject.content);
    }
    else {
      // Standard AS format: build content from name/summary/nameMap/summaryMap
      // Falls back to content/contentMap (HTML) when summary/summaryMap are absent
      const content: Record<string, { name: string; description: string }> = {};

      // nameMap and summaryMap provide per-language content
      const nameMap = apObject.nameMap || {};
      const summaryMap = apObject.summaryMap || {};
      const contentMap = apObject.contentMap || {};
      const allLanguages = new Set([...Object.keys(nameMap), ...Object.keys(summaryMap), ...Object.keys(contentMap)]);

      // Resolve description: prefer summary, fall back to content (strip HTML)
      const bareDescription = apObject.summary
        ? stripHtmlTags(apObject.summary)
        : (typeof apObject.content === 'string' ? stripHtmlTags(apObject.content) : '');

      // If there's a bare name/summary/content but no maps, use 'en' as default language
      if (allLanguages.size === 0 && (apObject.name || bareDescription)) {
        content.en = {
          name: apObject.name ? stripHtmlTags(apObject.name) : '',
          description: bareDescription,
        };
      }
      else {
        for (const lang of allLanguages) {
          content[lang] = {
            name: nameMap[lang] ? stripHtmlTags(nameMap[lang]) : '',
            description: summaryMap[lang] ? stripHtmlTags(summaryMap[lang]) : (contentMap[lang] ? stripHtmlTags(contentMap[lang]) : ''),
          };
        }
      }

      if (Object.keys(content).length > 0) {
        result.content = content;
      }
    }

    // --- Categories resolution ---
    // Priority: pavillion:categories > bare categories
    if (apObject['pavillion:categories'] !== undefined) {
      result.categories = apObject['pavillion:categories'];
    }
    else if (apObject.categories !== undefined) {
      result.categories = apObject.categories;
    }

    // --- Series resolution ---
    // Priority: pavillion:series > bare series
    if (apObject['pavillion:series'] !== undefined) {
      result.series = apObject['pavillion:series'];
    }
    else if (apObject.series !== undefined) {
      result.series = apObject.series;
    }

    // --- externalUrl + urlPrompt resolution ---
    // Security-critical: sanitize inbound attachment Link href and urlPrompt enum.
    // Cross-field invariant: both must be valid together, or both are null. A partial
    // record (only one field valid) is never persisted — it is dropped entirely.
    let parsedExternalUrl: string | null = null;
    if (Array.isArray(apObject.attachment)) {
      const externalLink = apObject.attachment.find(
        (a: any) => a && a.type === 'Link' && a.rel === 'external',
      );
      if (externalLink) {
        parsedExternalUrl = sanitizeExternalUrlHref(externalLink.href);
      }
    }

    let parsedPrompt: UrlPrompt | null = null;
    const rawPrompt = apObject['pavillion:urlPrompt'];
    if (typeof rawPrompt === 'string' && URL_PROMPT_VALUES.includes(rawPrompt as UrlPrompt)) {
      parsedPrompt = rawPrompt as UrlPrompt;
    }

    // Cross-field consistency: if only one is set, null them both
    if (!parsedExternalUrl || !parsedPrompt) {
      parsedExternalUrl = null;
      parsedPrompt = null;
    }

    result.externalUrl = parsedExternalUrl;
    result.urlPrompt = parsedPrompt;

    // --- Schedules resolution ---
    // Priority: pavillion:schedules > bare schedules > synthesize from startTime/endTime
    if (apObject['pavillion:schedules'] !== undefined) {
      result.schedules = apObject['pavillion:schedules'];
    }
    else if (apObject.schedules !== undefined) {
      result.schedules = apObject.schedules;
    }
    else if (apObject.startTime) {
      // Synthesize a schedule from standard AS startTime/endTime
      const schedule: Record<string, any> = {
        start: apObject.startTime,
      };
      if (apObject.endTime) {
        schedule.end = apObject.endTime;
      }
      result.schedules = [schedule];
    }

    // --- Origin-gated schedule fields ---
    // hideFromPublic (cancellation state) is a privileged field: only the source
    // instance that owns the event may set it. When `options.actorUri` is
    // provided and does not share the event's origin domain, strip
    // `hideFromPublic` from every schedule entry. The rest of the event is
    // allowed through so standard updates (name, summary, location, ...) from
    // authorized non-origin actors (e.g. remote Person editors) continue to
    // apply, but cancellation state cannot be forged across origins.
    if (options.actorUri && Array.isArray(result.schedules) && result.schedules.length > 0) {
      const eventOriginDomain = EventObject._extractOriginDomain(apObject);
      const actorDomain = EventObject._safeExtractDomain(options.actorUri);
      const originMismatch = !actorDomain || !eventOriginDomain || actorDomain !== eventOriginDomain;
      if (originMismatch) {
        result.schedules = result.schedules.map((s: Record<string, any>) => {
          if (s && typeof s === 'object' && 'hideFromPublic' in s) {
            const rest: Record<string, any> = {};
            for (const key of Object.keys(s)) {
              if (key !== 'hideFromPublic') {
                rest[key] = s[key];
              }
            }
            return rest;
          }
          return s;
        });
      }
    }

    // --- published → createdAt mapping ---
    // Map the AP `published` field to `createdAt` so CalendarEvent.fromObject()
    // can populate the canonical publication timestamp. Guards against invalid dates.
    if (apObject.published && typeof apObject.published === 'string') {
      const publishedDate = new Date(apObject.published);
      if (!isNaN(publishedDate.getTime())) {
        result.createdAt = publishedDate;
      }
    }

    // --- Date extraction from startTime ---
    if (apObject.startTime && !result.date) {
      const parsed = DateTime.fromISO(apObject.startTime);
      if (parsed.isValid) {
        result.date = parsed.toFormat('yyyy-MM-dd');
      }
    }

    // --- Location normalization ---
    if (apObject.location !== undefined) {
      result.location = EventObject._normalizeLocation(apObject.location);
    }

    return result;
  }

  /**
   * Extracts the origin domain of an inbound event. Prefers the canonical AP
   * `id` field (the event's own URI), falling back to `attributedTo` (the
   * owning actor URI). Returns null when neither yields a parseable URL.
   */
  private static _extractOriginDomain(apObject: Record<string, any>): string | null {
    const candidates = [apObject.id, apObject.attributedTo];
    for (const candidate of candidates) {
      const domain = EventObject._safeExtractDomain(candidate);
      if (domain) {
        return domain;
      }
    }
    return null;
  }

  /**
   * Parses a URI string and returns its hostname, or null for any malformed
   * or non-string input. Never throws — callers use null to signal that
   * domain-equality checks cannot be performed.
   */
  private static _safeExtractDomain(uri: unknown): string | null {
    if (typeof uri !== 'string' || uri.length === 0) {
      return null;
    }
    try {
      return new URL(uri).hostname || null;
    }
    catch {
      return null;
    }
  }

  /**
   * Sanitizes a Pavillion content object (language-keyed { name, description } entries).
   * Applies stripHtmlTags to all string values to prevent XSS from federated sources.
   */
  private static _sanitizeContentObject(content: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};
    for (const lang of Object.keys(content)) {
      const entry = content[lang];
      if (entry && typeof entry === 'object') {
        sanitized[lang] = {
          ...entry,
          name: typeof entry.name === 'string' ? stripHtmlTags(entry.name) : entry.name,
          description: typeof entry.description === 'string' ? stripHtmlTags(entry.description) : entry.description,
          accessibilityInfo: typeof entry.accessibilityInfo === 'string' ? stripHtmlTags(entry.accessibilityInfo) : entry.accessibilityInfo,
        };
      }
      else {
        sanitized[lang] = entry;
      }
    }
    return sanitized;
  }

  /**
   * Normalizes an AP location value into the EventLocation-compatible shape.
   * Handles Place objects with optional PostalAddress, plain strings, and
   * arrays (Mobilizon hybrid events send [Place, VirtualLocation]).
   * All string values are sanitized against XSS.
   */
  private static _normalizeLocation(location: any): Record<string, any> {
    if (typeof location === 'string') {
      return { name: stripHtmlTags(location) };
    }

    // Handle arrays: find first Place, optionally extract VirtualLocation URL
    if (Array.isArray(location)) {
      const place = location.find((item: any) =>
        item && typeof item === 'object' && item.type === 'Place',
      );
      const virtual = location.find((item: any) =>
        item && typeof item === 'object' && item.type === 'VirtualLocation',
      );

      if (place) {
        const normalized = EventObject._normalizeSingleLocation(place);
        if (virtual?.url) {
          normalized.virtualUrl = virtual.url;
        }
        return normalized;
      }

      if (virtual?.url) {
        return { name: stripHtmlTags(virtual.name || virtual.url), virtualUrl: virtual.url };
      }

      // Fallback: try the first non-null element
      const first = location.find((item: any) => item != null);
      if (first) {
        return EventObject._normalizeLocation(first);
      }

      return {};
    }

    if (typeof location === 'object' && location !== null) {
      return EventObject._normalizeSingleLocation(location);
    }

    return { name: stripHtmlTags(String(location)) };
  }

  /**
   * Normalizes a single AP location object (Place or similar) into the
   * EventLocation-compatible shape. All string values are sanitized against XSS.
   */
  private static _normalizeSingleLocation(location: Record<string, any>): Record<string, any> {
    const normalized: Record<string, any> = {};

    if (location.name) {
      normalized.name = stripHtmlTags(location.name);
    }

    // Extract PostalAddress fields if address is a sub-object
    const addr = location.address;
    if (addr && typeof addr === 'object') {
      if (addr.streetAddress) normalized.address = stripHtmlTags(addr.streetAddress);
      if (addr.addressLocality) normalized.city = stripHtmlTags(addr.addressLocality);
      if (addr.addressRegion) normalized.state = stripHtmlTags(addr.addressRegion);
      if (addr.postalCode) normalized.postalCode = stripHtmlTags(addr.postalCode);
      if (addr.addressCountry) normalized.country = stripHtmlTags(addr.addressCountry);
    }
    else if (typeof addr === 'string') {
      normalized.address = stripHtmlTags(addr);
    }

    return normalized;
  }

  /**
   * Resolves startTime from the first schedule's startDate, falling back to the event date field.
   */
  private _resolveStartTime(event: CalendarEvent): string {
    const firstSchedule = event.schedules[0];
    if (firstSchedule?.startDate) {
      return firstSchedule.startDate.toISO()!;
    }

    // Fallback: parse date string as YYYY-MM-DD and emit as midnight UTC
    if (event.date) {
      const parsed = DateTime.fromISO(String(event.date), { zone: 'utc' });
      if (parsed.isValid) {
        return parsed.toISO()!;
      }
    }

    return DateTime.utc().toISO()!;
  }

  /**
   * Builds an ActivityPub Place object from an EventLocation, or null if no location.
   */
  private _buildLocation(location: EventLocation | null): Record<string, any> | null {
    if (!location) {
      return null;
    }

    // Only emit if at least a name is present
    if (!location.name || location.name.trim().length === 0) {
      return null;
    }

    const place: Record<string, any> = {
      type: 'Place',
      name: location.name,
    };

    // Add PostalAddress sub-object if any address fields are present
    const hasAddress = location.address?.trim();
    const hasCity = location.city?.trim();
    const hasState = location.state?.trim();
    const hasPostalCode = location.postalCode?.trim();
    const hasCountry = location.country?.trim();

    if (hasAddress || hasCity || hasState || hasPostalCode || hasCountry) {
      const address: Record<string, any> = {
        type: 'PostalAddress',
      };

      if (hasAddress) address.streetAddress = location.address;
      if (hasCity) address.addressLocality = location.city;
      if (hasState) address.addressRegion = location.state;
      if (hasPostalCode) address.postalCode = location.postalCode;
      if (hasCountry) address.addressCountry = location.country;

      place.address = address;
    }

    return place;
  }
}

export { EventObject };
