/**
 * Pure ICS → Pavillion mapper.
 *
 * Translates a parsed `node-ical` VEVENT into Pavillion's native
 * {@link CalendarEventContent} + {@link CalendarEventSchedule} shape.
 *
 * This module is strictly pure:
 * - NO database I/O
 * - NO network I/O
 * - NO logging above warn level (a single structured warn is emitted
 *   when timezone fallback degrades all the way to UTC)
 *
 * The sync orchestrator (pv-1qcp.2.4) wraps this function with entity
 * persistence, import-run bookkeeping, and source-level rate limiting.
 * Keeping the mapper pure means every field-mapping and recurrence
 * edge case is covered by unit tests that require no fixtures, no
 * sandbox, and no mocks beyond a logger spy.
 *
 * @see epic pv-1qcp DESIGN — field mapping, timezone fallback, recurrence handling
 * @see global-translated-model — single-language content record mirrors user-created events
 * @see complexity-playbook — no HTML sanitizer dep; minimal tag strip for v1
 */

import { DateTime, IANAZone } from 'luxon';
import type { VEvent, DateWithTimeZone } from 'node-ical';

import {
  CalendarEventContent,
  CalendarEventSchedule,
  EventFrequency,
} from '@/common/model/events';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('calendar.import.mapper');

// ---------------------------------------------------------------------------
// Limits (truncate before storage to match backend column widths)
// ---------------------------------------------------------------------------

/** Max stored length of SUMMARY → content.name. */
export const MAX_TITLE_LENGTH = 512;
/** Max stored length of external_uid (UID + optional RECURRENCE-ID disambiguator). */
export const MAX_EXTERNAL_UID_LENGTH = 512;
/** Max length of a LOCATION value *before* it is appended to description. */
export const MAX_LOCATION_LENGTH = 1024;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/**
 * Structured signal returned to the sync orchestrator when a VEVENT carries
 * a RECURRENCE-ID that modifies (rather than merely cancels) a single
 * occurrence of a recurring parent.
 *
 * Per DESIGN: the orchestrator interprets this by (a) cancelling the parent
 * occurrence on the given date, and (b) creating a standalone event from
 * `standaloneEvent`. The mapper never writes — it only reports the intent.
 */
export type RecurrenceOverrideSignal = {
  /** True when a parent-occurrence cancellation must be recorded. */
  cancelOriginal: boolean;
  /**
   * When present, the caller must also persist a standalone event derived
   * from this mapping output. Omitted for pure STATUS:CANCELLED overrides.
   */
  standaloneEvent?: MapperOutput;
};

/**
 * Pure mapper output for a single VEVENT.
 */
export type MapperOutput = {
  /** Single-language content record, language === calendarPrimaryLanguage. */
  content: CalendarEventContent;
  /** Primary schedule (start/end plus optional RRULE frequency/interval/byDay). */
  schedule: CalendarEventSchedule;
  /** Exclusion schedules derived from EXDATE lines (empty when none). */
  exclusions: CalendarEventSchedule[];
  /** External UID (truncated to {@link MAX_EXTERNAL_UID_LENGTH}). */
  external_uid: string;
  /**
   * ISO-8601 serialization of the VEVENT's RECURRENCE-ID, when present.
   * Used by the sync orchestrator to disambiguate per-occurrence overrides.
   */
  external_recurrence_id?: string;
  /** LAST-MODIFIED value, when present. Used by sync for idempotency. */
  source_last_modified?: DateTime;
  /**
   * Narrow allowlist of structured properties preserved for forward-looking
   * readers that aren't wired yet. Each entry is tied to a concrete future
   * feature (category import, location enrichment, virtual/hybrid location)
   * and is shaped to match what that reader will eventually consume.
   *
   * The allowlist is intentionally small: blanket X-* passthrough was dropped
   * because (a) almost nothing real-world emits useful X-* extensions, and
   * (b) some standard fields (ORGANIZER/ATTENDEE/ATTACH/X-ALT-DESC) carry PII
   * or HTML that we don't want to warehouse without a reader and a sanitizer.
   * See DEC-004 (privacy-first) and the mapper's `collectXProps` for the
   * canonical list.
   */
  x_props: Record<string, unknown>;
  /**
   * External URL attached to the event (from the ICS `URL` property). Null
   * when absent.
   */
  external_url: string | null;
  /**
   * Set only on the RECURRENCE-ID branch. The orchestrator uses this as
   * the authoritative signal for cancel+standalone handling; callers must
   * NOT attempt to infer this from `external_recurrence_id` alone (a pure
   * STATUS:CANCELLED override has recurrence_id but no standalone event).
   */
  recurrenceOverride?: RecurrenceOverrideSignal;
};

/**
 * Inputs for the mapper.
 */
export type MapperInput = {
  vevent: VEvent;
  calendarPrimaryLanguage: string;
  /** Optional calendar-level X-WR-TIMEZONE fallback from the enclosing VCALENDAR. */
  calendarFallbackTimezone?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * node-ical returns property values as either a plain string or a
 * `{ params, val }` wrapper when the source included ICS parameters.
 * This helper normalizes both forms to the underlying value.
 */
function unwrapParam<T>(value: T | { val: T; params: Record<string, string> } | undefined): T | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'object' && value !== null && 'val' in (value as object)) {
    return (value as { val: T }).val;
  }
  return value as T;
}

/**
 * Truncates a string to the given byte-approximate character limit.
 * Returns the original string when already within bounds.
 */
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Removes HTML tags and decodes common entities to produce plaintext.
 *
 * Intentionally minimal per complexity-playbook YAGNI: v1 does not add an
 * external sanitizer dependency. Federation ingest and other inbound
 * pipelines already operate on trusted-after-XSS-sanitization text, and
 * the ICS description here is only ever surfaced after the standard
 * downstream rendering pipeline.
 */
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
}

/**
 * Extracts the TZID that node-ical stamped onto a parsed date.
 *
 * `node-ical` attaches `tz` on the Date instance for DATE-TIME values with
 * a `TZID` parameter. Date-only values (`datetype === 'date'`) have no
 * timezone by construction.
 */
function extractTzid(value: DateWithTimeZone | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.tz;
}

/**
 * Resolves the effective timezone per the epic's fallback chain:
 *   1. Recognized TZID (IANA) → preserve
 *   2. Unrecognized TZID + X-WR-TIMEZONE (recognized) → use X-WR-TIMEZONE
 *   3. Otherwise → UTC + structured warn log
 *
 * @param tzid The TZID stamped by node-ical on DTSTART, if any.
 * @param fallbackTz The VCALENDAR-level X-WR-TIMEZONE (or undefined).
 * @param externalUid Used in the warn log only (no PII).
 */
function resolveTimezone(
  tzid: string | undefined,
  fallbackTz: string | undefined,
  externalUid: string,
): string {
  if (tzid && IANAZone.isValidZone(tzid)) {
    return tzid;
  }
  if (fallbackTz && IANAZone.isValidZone(fallbackTz)) {
    return fallbackTz;
  }
  logger.warn(
    {
      externalUid,
      requestedTzid: tzid ?? null,
      fallbackTz: fallbackTz ?? null,
    },
    'ICS event timezone unrecognized; falling back to UTC',
  );
  return 'UTC';
}

/**
 * Converts a JS Date (from node-ical) into a Luxon DateTime in the given zone.
 *
 * node-ical emits wall-clock instants as UTC-normalized JS Date values even
 * when the ICS source used a TZID. To preserve the original wall-clock for
 * downstream RRULE materialization, we take the UTC instant and reinterpret
 * it in the resolved zone.
 */
function toDateTime(d: Date, zone: string): DateTime {
  return DateTime.fromJSDate(d, { zone: 'utc' }).setZone(zone, { keepLocalTime: false });
}

/**
 * Translates an ICS FREQ string to our {@link EventFrequency} enum.
 * Returns null for frequencies we do not yet model (SECONDLY/MINUTELY/HOURLY).
 */
function parseFreq(freq: string | undefined): EventFrequency | null {
  switch ((freq ?? '').toUpperCase()) {
    case 'DAILY': return EventFrequency.DAILY;
    case 'WEEKLY': return EventFrequency.WEEKLY;
    case 'MONTHLY': return EventFrequency.MONTHLY;
    case 'YEARLY': return EventFrequency.YEARLY;
    default: return null;
  }
}

/**
 * Collects an explicit allowlist of forward-looking structured properties.
 *
 * The allowlist replaced an earlier "passthrough unless mapped" contract
 * that warehoused arbitrary X-* properties plus several standard fields with
 * no readers. The narrow set kept here is each tied to a concrete future
 * feature:
 *
 *   - `categories`              → future category-import reader
 *   - `geo`                     → future location enrichment (lat/lon)
 *   - `X-APPLE-STRUCTURED-LOCATION` → future location enrichment (richer)
 *   - `conference` (RFC 7986)   → future virtual/hybrid location feature
 *
 * Everything else is dropped on purpose. ORGANIZER/ATTENDEE carry attendee
 * email PII (DEC-004); ATTACH carries arbitrary URLs/binaries with no target
 * field; X-ALT-DESC is HTML and would need a sanitizer Pavillion doesn't yet
 * have. Keeping these out of `x_props` keeps the stored shape safe to expose
 * to a future reader without a privacy/safety audit.
 *
 * Node-ical strips the `X-` prefix from X-* property names but does NOT
 * lowercase the remainder (see node_modules/node-ical/ical.js:1064-1067 —
 * `name = name.slice(2)` with no `.toLowerCase()` call). So the runtime
 * key for `X-APPLE-STRUCTURED-LOCATION` in the parsed VEVENT is the
 * uppercase `APPLE-STRUCTURED-LOCATION`. We re-prefix on output to keep
 * the stored key matching the source ICS property name exactly.
 */
function collectXProps(vevent: VEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const source = vevent as unknown as Record<string, unknown>;

  if ('categories' in source && source.categories !== undefined) {
    out.categories = source.categories;
  }
  if ('geo' in source && source.geo !== undefined) {
    out.geo = source.geo;
  }
  if ('conference' in source && source.conference !== undefined) {
    out.conference = source.conference;
  }
  // node-ical exposes X-APPLE-STRUCTURED-LOCATION with the X- prefix stripped
  // but the remainder preserved in its original (uppercase) case. Re-prefix
  // on output so the stored key matches the source ICS property name exactly.
  if ('APPLE-STRUCTURED-LOCATION' in source && source['APPLE-STRUCTURED-LOCATION'] !== undefined) {
    out['X-APPLE-STRUCTURED-LOCATION'] = source['APPLE-STRUCTURED-LOCATION'];
  }

  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Maps a parsed VEVENT into Pavillion's native event shape.
 *
 * The function is pure and idempotent: calling it twice with the same input
 * produces structurally identical output.
 *
 * @throws Never; unrecognized timezones fall back per the documented chain
 *         and log a single warn. Callers that wish to surface a hard error
 *         should consult `source_last_modified`/`external_uid` against their
 *         own persistence layer, not this mapper.
 */
export function mapVEvent(input: MapperInput): MapperOutput {
  const { vevent, calendarPrimaryLanguage, calendarFallbackTimezone } = input;

  // --- UID + RECURRENCE-ID -------------------------------------------------

  const uidRaw = vevent.uid ?? '';
  const externalUid = truncate(uidRaw, MAX_EXTERNAL_UID_LENGTH);

  const recurrenceIdValue = vevent.recurrenceid;
  const externalRecurrenceId = recurrenceIdValue instanceof Date
    ? recurrenceIdValue.toISOString()
    : undefined;

  // --- Timezone resolution -------------------------------------------------

  const tzid = extractTzid(vevent.start);
  const zone = resolveTimezone(tzid, calendarFallbackTimezone, externalUid);

  // --- Title (SUMMARY) -----------------------------------------------------

  const summaryRaw = unwrapParam(vevent.summary) ?? '';
  const title = truncate(summaryRaw, MAX_TITLE_LENGTH);

  // --- Description + Location ---------------------------------------------

  const descriptionRaw = unwrapParam(vevent.description) ?? '';
  let description = stripHtml(descriptionRaw);

  const locationRaw = unwrapParam(vevent.location) ?? '';
  const locationTrimmed = locationRaw.trim();
  if (locationTrimmed.length > 0) {
    const locationBounded = truncate(locationTrimmed, MAX_LOCATION_LENGTH);
    description = description.length > 0
      ? `${description}\nLocation: ${locationBounded}`
      : `Location: ${locationBounded}`;
  }

  // --- Content (single-language record) ------------------------------------

  const content = new CalendarEventContent(
    calendarPrimaryLanguage,
    title,
    description,
  );

  // --- Schedule: DTSTART/DTEND ---------------------------------------------

  if (!vevent.start) {
    // Per DESIGN: a VEVENT without DTSTART is not meaningfully importable.
    // This is a contract violation on the upstream side; we surface it via a
    // thrown Error that the sync orchestrator maps to ImportSourceParseError.
    throw new Error('VEVENT is missing DTSTART; cannot map.');
  }
  const schedule = new CalendarEventSchedule(
    externalUid || undefined,
    toDateTime(vevent.start, zone),
    // endDate is reserved for the recurrence end boundary (RRULE UNTIL); do
    // NOT populate it from DTEND — that's a per-instance end time which maps
    // to {@link CalendarEventSchedule.eventEndTime} below.
    undefined,
  );
  if (vevent.end) {
    schedule.eventEndTime = toDateTime(vevent.end, zone);
  }

  // --- RRULE ---------------------------------------------------------------

  const rruleOpts = vevent.rrule?.options as
    | {
      freq?: string;
      interval?: number;
      count?: number;
      until?: Date;
      byDay?: string[];
      byweekday?: Array<string | number>;
    }
    | undefined;
  if (rruleOpts && rruleOpts.freq) {
    schedule.frequency = parseFreq(rruleOpts.freq);
    // RFC 5545 default interval is 1; preserve when rrule emits 1 explicitly.
    schedule.interval = typeof rruleOpts.interval === 'number' ? rruleOpts.interval : 1;
    if (typeof rruleOpts.count === 'number') {
      schedule.count = rruleOpts.count;
    }
    if (rruleOpts.until instanceof Date) {
      // UNTIL is stored as the recurrence end boundary on the primary schedule.
      // It is distinct from eventEndTime, which is the per-instance end time.
      schedule.endDate = toDateTime(rruleOpts.until, zone);
    }
    // Prefer the upstream-normalized byDay (string[]); fall back to byweekday
    // when rrule only populated the latter.
    const byDay = rruleOpts.byDay
      ?? (Array.isArray(rruleOpts.byweekday)
        ? rruleOpts.byweekday.filter((v): v is string => typeof v === 'string')
        : undefined);
    if (byDay && byDay.length > 0) {
      schedule.byDay = [...byDay];
    }
  }

  // --- EXDATE --------------------------------------------------------------

  const exclusions: CalendarEventSchedule[] = [];
  const exdateMap = vevent.exdate;
  if (exdateMap && typeof exdateMap === 'object') {
    // node-ical uses a dual-key layout (date-only + ISO). Deduplicate by the
    // underlying Date value, which is identical across both keys.
    const seen = new Set<number>();
    for (const key of Object.keys(exdateMap)) {
      const d = (exdateMap as Record<string, DateWithTimeZone | undefined>)[key];
      if (!d) continue;
      const ts = d.getTime();
      if (seen.has(ts)) continue;
      seen.add(ts);

      const exclusion = new CalendarEventSchedule(undefined, toDateTime(d, zone));
      exclusion.isExclusion = true;
      exclusion.hideFromPublic = true; // EXDATE semantics: silent skip
      exclusions.push(exclusion);
    }
  }

  // --- LAST-MODIFIED -------------------------------------------------------

  const lastModified = vevent.lastmodified instanceof Date
    ? DateTime.fromJSDate(vevent.lastmodified, { zone: 'utc' })
    : undefined;

  // --- URL -----------------------------------------------------------------

  const urlRaw = unwrapParam(vevent.url);
  const externalUrl = (typeof urlRaw === 'string' && urlRaw.length > 0) ? urlRaw : null;

  // --- x_props -------------------------------------------------------------

  const xProps = collectXProps(vevent);

  // --- Base output ---------------------------------------------------------

  const base: MapperOutput = {
    content,
    schedule,
    exclusions,
    external_uid: externalUid,
    external_recurrence_id: externalRecurrenceId,
    source_last_modified: lastModified,
    x_props: xProps,
    external_url: externalUrl,
  };

  // --- RECURRENCE-ID branch -----------------------------------------------
  //
  // Two distinct override flavors per DESIGN:
  //
  //   1. STATUS:CANCELLED  → caller records a cancellation-shown marker on the
  //      parent occurrence. No standalone event is written.
  //
  //   2. Modified content  → caller records BOTH a cancellation of the parent
  //      occurrence AND creates a standalone event. We return the full
  //      MapperOutput (minus its own recurrenceOverride) as `standaloneEvent`.
  //
  // This split is the contract that pv-1qcp.2.4 consumes. Encoding it here,
  // and only here, means the sync orchestrator never has to inspect
  // `recurrenceid` / `status` directly.

  if (externalRecurrenceId) {
    const isCancelled = (vevent.status ?? '').toUpperCase() === 'CANCELLED';
    if (isCancelled) {
      base.recurrenceOverride = {
        cancelOriginal: true,
      };
    }
    else {
      // Build the standalone mapping by reusing `base` (sans override).
      const standalone: MapperOutput = { ...base };
      // Avoid an infinite structural loop if a consumer serializes.
      delete (standalone as { recurrenceOverride?: unknown }).recurrenceOverride;
      base.recurrenceOverride = {
        cancelOriginal: true,
        standaloneEvent: standalone,
      };
    }
  }

  return base;
}
