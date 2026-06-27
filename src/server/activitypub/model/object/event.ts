import config from 'config';
import he from 'he';
import { DateTime } from 'luxon';
import striptags from 'striptags';

import { Calendar } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventSchedule, UrlPrompt, URL_PROMPT_VALUES } from '@/common/model/events';
import { EventLocation, EventLocationSpace } from '@/common/model/location';
import { ActivityPubObject } from '@/server/activitypub/model/base';
import { SeriesObject } from '@/server/activitypub/model/object/series';
import { createLogger } from '@/server/common/helper/logger';
import { sanitizeExternalUrlHref } from '@/server/activitypub/helper/url-sanitizer';

const logger = createLogger('activitypub');

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
    // location: emitted as Place with optional PostalAddress; omitted if no location.
    // When a Space is present, the flat `as:Place.name` is concatenated as
    // `Place — Space` in the primary language so non-Pavillion peers (Mobilizon,
    // Mastodon, Gancio) see a sensible flattened label. Pavillion-aware peers
    // ignore the flat surface and read the structured `pavillion:space` extension.
    const locationObj = this._buildLocation(event.location, event.space, primaryLanguage);
    if (locationObj) {
      result.location = locationObj;
    }

    // pavillion:place: Pavillion-native Place extension. Emitted whenever a
    // location is present, with per-language content map carrying name and
    // accessibilityInfo. Wire shape is forward-compatible: today
    // EventLocation.name is single-string, so every content[lang].name carries
    // the same value; when Place names later become translatable, only local
    // storage changes — the wire format does not.
    if (event.location) {
      result['pavillion:place'] = this._buildPavillionPlace(event.location, calendar);
    }

    // pavillion:space: Pavillion-native Space extension. Emitted only when
    // BOTH a location and a space are present — a Space without its parent
    // Place is meaningless on the wire and the inbound parser drops orphans.
    // The space id is anchored under the place id (parent-path prefix
    // `${placeId}/spaces/${spaceId}`) so the inbound parent-path check passes
    // round-trip.
    if (event.location && event.space) {
      result['pavillion:space'] = this._buildPavillionSpace(event.space, calendar);
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
    // Priority: pavillion:place (Option B extension) > flat AS location.
    // pavillion:place carries per-language content; flat as:Place is the
    // non-aware-peer fallback (Mobilizon, Mastodon, Gancio).
    const pavPlace = apObject['pavillion:place'];
    if (pavPlace && typeof pavPlace === 'object' && !Array.isArray(pavPlace)) {
      const sanitizedPlaceContent = EventObject._sanitizeLocationContent(pavPlace.content);

      // EventLocation.name is a single-string column today. Pick the first
      // available content[lang].name; today every entry repeats the same
      // string anyway, so the choice is benign. When Place names later become
      // translatable, this pick becomes a per-language population.
      let placeName = '';
      for (const lang of Object.keys(sanitizedPlaceContent)) {
        const entry = sanitizedPlaceContent[lang];
        if (entry && typeof entry.name === 'string' && entry.name.length > 0) {
          placeName = entry.name;
          break;
        }
      }

      // Build EventLocation-shaped object. Address fields come from flat keys
      // on the extension; per-language accessibilityInfo lives in content.
      const locationOut: Record<string, any> = {
        name: placeName,
      };
      // Validate pavPlace.id before using it as an origin_uri identifier.
      // Failure here means we keep the locally-known content but do NOT stamp
      // an originUri, so the dedup-by-origin path won't see this row.
      const validatedPlaceId = EventObject._validatePavillionId(pavPlace.id, options.actorUri);
      if (validatedPlaceId !== null) {
        locationOut.originUri = validatedPlaceId;
      }
      if (typeof pavPlace.address === 'string') locationOut.address = stripHtmlTags(pavPlace.address);
      if (typeof pavPlace.city === 'string') locationOut.city = stripHtmlTags(pavPlace.city);
      if (typeof pavPlace.state === 'string') locationOut.state = stripHtmlTags(pavPlace.state);
      if (typeof pavPlace.postalCode === 'string') locationOut.postalCode = stripHtmlTags(pavPlace.postalCode);
      if (typeof pavPlace.country === 'string') locationOut.country = stripHtmlTags(pavPlace.country);

      // EventLocation.fromObject reads content[lang] = { accessibilityInfo }.
      // We strip out the per-language `name` from the content map at the
      // wire-shape boundary because the local model stores name as a single
      // top-level string, not in the content entries.
      const locationContent: Record<string, any> = {};
      for (const lang of Object.keys(sanitizedPlaceContent)) {
        const entry = sanitizedPlaceContent[lang];
        if (entry && typeof entry === 'object') {
          locationContent[lang] = {
            accessibilityInfo: typeof entry.accessibilityInfo === 'string' ? entry.accessibilityInfo : '',
          };
        }
      }
      if (Object.keys(locationContent).length > 0) {
        locationOut.content = locationContent;
      }
      result.location = locationOut;

      // pavillion:space: only consume if its id parent path matches the
      // pavillion:place.id exactly (place.id + '/spaces/'). A mismatch is
      // dropped with a structured warning carrying structural identifiers
      // only — never content (privacy/logging.md).
      //
      // The space id is validated through _validatePavillionId so the
      // origin_uri stamp only fires for ids that survived URL/length/scheme
      // (and, if actorUri is supplied, host) checks. The parent-path check
      // continues to use the raw pavPlace.id string for prefix comparison —
      // host equality between place and space is established structurally by
      // that prefix, and either (a) the parent place id failed its own
      // validation (so origin_uri on the place is already null) or (b) the
      // space id will pass its own validation against the same actor host.
      const pavSpace = apObject['pavillion:space'];
      if (pavSpace && typeof pavSpace === 'object' && !Array.isArray(pavSpace)) {
        const placeId = typeof pavPlace.id === 'string' ? pavPlace.id : '';
        const spaceId = typeof pavSpace.id === 'string' ? pavSpace.id : '';
        const expectedPrefix = placeId.length > 0 ? `${placeId}/spaces/` : '';
        const parentMatches = expectedPrefix.length > 0 && spaceId.startsWith(expectedPrefix);

        if (parentMatches) {
          const sanitizedSpaceContent = EventObject._sanitizeSpaceContent(pavSpace.content);
          const spaceOut: Record<string, any> = {};
          const validatedSpaceId = EventObject._validatePavillionId(pavSpace.id, options.actorUri);
          if (validatedSpaceId !== null) {
            spaceOut.originUri = validatedSpaceId;
          }
          if (Object.keys(sanitizedSpaceContent).length > 0) {
            spaceOut.content = sanitizedSpaceContent;
          }
          result.space = spaceOut;
        }
        else {
          logger.warn(
            {
              activityId: typeof apObject.id === 'string' ? apObject.id : null,
              senderDomain: EventObject._safeExtractDomain(apObject.attributedTo),
              placeId: placeId || null,
              spaceId: spaceId || null,
            },
            'pavillion:space dropped: parent path does not match pavillion:place.id',
          );
        }
      }
    }
    else if (apObject.location !== undefined) {
      // No pavillion:place extension: fall through to existing flat-path
      // normalization. Backward compatible with Mobilizon, Mastodon, Gancio.
      // pavillion:space without pavillion:place is dropped silently here
      // (the ingester has no parent context to anchor it to).
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
   * Validates a pavillion:place / pavillion:space id from the wire. Returns
   * the id string when it passes structural checks; returns null otherwise so
   * the caller can treat the row as unstamped (locally-known attributes only,
   * no `originUri` mirror key).
   *
   * Checks performed:
   *   - Must be a non-empty string of at most 2048 characters.
   *   - Must parse as a URL (rejects malformed strings).
   *   - Scheme must be http: or https: (rejects javascript:, data:, ftp:, …).
   *   - When `actorUri` is supplied, the parsed host must equal the actor's
   *     host. The dedup-by-origin_uri path therefore only sees ids whose
   *     sender has been authenticated against that host. A mismatch logs a
   *     structured warning carrying only structural identifiers
   *     (`{senderDomain, claimedHost}`); content is never logged
   *     (privacy/logging.md).
   *
   * Never throws — null is the failure signal.
   *
   * @param id - The candidate id string from the AP payload
   * @param actorUri - Optional sender actor URI for host-equality enforcement
   */
  private static _validatePavillionId(id: unknown, actorUri?: string): string | null {
    if (typeof id !== 'string' || id.length === 0 || id.length > 2048) {
      return null;
    }
    let parsed: URL;
    try {
      parsed = new URL(id);
    }
    catch {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (typeof actorUri === 'string' && actorUri.length > 0) {
      const actorHost = EventObject._safeExtractDomain(actorUri);
      if (!actorHost || parsed.host !== actorHost) {
        logger.warn(
          {
            senderDomain: actorHost,
            claimedHost: parsed.host,
          },
          'pavillion id rejected: actor host does not match claimed host',
        );
        return null;
      }
    }
    return id;
  }

  /**
   * Sanitizes a pavillion:place content object (language-keyed
   * `{ name, accessibilityInfo }` entries). Strips HTML from BOTH name and
   * accessibilityInfo per language. These fields are plaintext at every
   * consumption surface (display, aria-label, federation echo) so
   * strip-on-input is the right posture (privacy/security playbook for
   * plaintext fields).
   */
  private static _sanitizeLocationContent(content: any): Record<string, { name: string; accessibilityInfo: string }> {
    const sanitized: Record<string, { name: string; accessibilityInfo: string }> = {};
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      return sanitized;
    }
    for (const lang of Object.keys(content)) {
      const entry = content[lang];
      if (entry && typeof entry === 'object') {
        sanitized[lang] = {
          name: typeof entry.name === 'string' ? stripHtmlTags(entry.name) : '',
          accessibilityInfo: typeof entry.accessibilityInfo === 'string' ? stripHtmlTags(entry.accessibilityInfo) : '',
        };
      }
    }
    return sanitized;
  }

  /**
   * Sanitizes a pavillion:space content object (language-keyed
   * `{ name, accessibilityInfo }` entries). Strips HTML from BOTH name and
   * accessibilityInfo per language. Mirrors the Place sanitizer's posture.
   */
  private static _sanitizeSpaceContent(content: any): Record<string, { name: string; accessibilityInfo: string }> {
    const sanitized: Record<string, { name: string; accessibilityInfo: string }> = {};
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      return sanitized;
    }
    for (const lang of Object.keys(content)) {
      const entry = content[lang];
      if (entry && typeof entry === 'object') {
        sanitized[lang] = {
          name: typeof entry.name === 'string' ? stripHtmlTags(entry.name) : '',
          accessibilityInfo: typeof entry.accessibilityInfo === 'string' ? stripHtmlTags(entry.accessibilityInfo) : '',
        };
      }
    }
    return sanitized;
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
   * Builds the pavillion:place extension object from an EventLocation. Emitted
   * whenever a location is present (even with no per-language content). The id
   * URL is minted from the canonical instance domain (config.get('domain'), NEVER
   * req.host — host-header spoofing risk per security advisor LOW finding) plus
   * the calendar urlName and the location UUID.
   *
   * Wire shape — flat top-level address fields plus a content map keyed by every
   * language present in the location's translatable content. Each content entry
   * carries BOTH name and accessibilityInfo; today EventLocation.name is a single
   * string so every entry's name field carries the same value, but when Place
   * names later become translatable the wire format stays identical and only
   * local storage changes.
   */
  private _buildPavillionPlace(location: EventLocation, calendar: Calendar): Record<string, any> {
    const domain = config.get('domain');
    return {
      id: `https://${domain}/calendars/${calendar.urlName}/places/${location.id}`,
      address: location.address,
      city: location.city,
      state: location.state,
      postalCode: location.postalCode,
      country: location.country,
      content: Object.fromEntries(
        Object.entries(location._content).map(([lang, c]) => [
          lang,
          { name: location.name, accessibilityInfo: c.accessibilityInfo },
        ]),
      ),
    };
  }

  /**
   * Builds the pavillion:space extension object from an EventLocationSpace.
   * The id URL is minted from the canonical instance domain (config.get('domain'),
   * NEVER req.host — host-header spoofing risk per security advisor LOW finding)
   * with the parent Place's id segment included so the inbound parent-path
   * prefix check (`${placeId}/spaces/${spaceId}`) passes round-trip.
   *
   * Wire shape — content map keyed by every language present in the space's
   * translatable content. Each entry carries BOTH name and accessibilityInfo;
   * Space names are translatable today so each language entry can carry its
   * own name string.
   */
  private _buildPavillionSpace(space: EventLocationSpace, calendar: Calendar): Record<string, any> {
    const domain = config.get('domain');
    return {
      // ActivityPub identifier (NOT a route). The
      // `/calendars/.../places/.../spaces/...` form is an opaque AP id used
      // for cross-instance reference equality; there is no HTTP GET handler
      // mounted at this path. Per-Space CRUD routes were removed when nested
      // Place + Spaces save subsumed them.
      id: `https://${domain}/calendars/${calendar.urlName}/places/${space.placeId}/spaces/${space.id}`,
      content: Object.fromEntries(
        Object.entries(space._content).map(([lang, c]) => [
          lang,
          { name: c.name, accessibilityInfo: c.accessibilityInfo },
        ]),
      ),
    };
  }

  /**
   * Builds an ActivityPub Place object from an EventLocation, or null if no location.
   *
   * When a Space is present, the flat `name` field is concatenated as
   * `${Place.name} — ${Space.name}` using the supplied primary language to pick
   * the Space's translated name. This gives non-Pavillion peers (Mobilizon,
   * Mastodon, Gancio) a sensible flattened label since they cannot consume the
   * structured `pavillion:space` extension. The primary-language pick MUST match
   * the one used for event name/summary so the flat surface stays internally
   * consistent.
   *
   * @param location - The event's Place, or null if the event is location-less
   * @param space - The event's Space, if any. Suppressed when Place is absent.
   * @param primaryLanguage - The primary language code chosen for event content
   */
  private _buildLocation(
    location: EventLocation | null,
    space: EventLocationSpace | null = null,
    primaryLanguage: string = 'en',
  ): Record<string, any> | null {
    if (!location) {
      return null;
    }

    // Only emit if at least a name is present
    if (!location.name || location.name.trim().length === 0) {
      return null;
    }

    // Concatenate Place — Space in the primary language when a Space is present.
    // Mirrors the event-content primary-language pick: prefer the requested
    // language, fall back to the first language with a non-empty space name.
    let displayName = location.name;
    if (space) {
      const primarySpaceName = space._content[primaryLanguage]?.name;
      let spaceName = primarySpaceName && primarySpaceName.trim().length > 0
        ? primarySpaceName
        : '';
      if (!spaceName) {
        for (const lang of Object.keys(space._content)) {
          const c = space._content[lang];
          if (c?.name && c.name.trim().length > 0) {
            spaceName = c.name;
            break;
          }
        }
      }
      if (spaceName) {
        displayName = `${location.name} — ${spaceName}`;
      }
    }

    const place: Record<string, any> = {
      type: 'Place',
      name: displayName,
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
