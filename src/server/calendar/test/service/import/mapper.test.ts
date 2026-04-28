import { describe, it, expect, afterEach } from 'vitest';
import sinon from 'sinon';
import type { VEvent, DateWithTimeZone } from 'node-ical';

import {
  mapVEvent,
  MAX_TITLE_LENGTH,
  MAX_EXTERNAL_UID_LENGTH,
  MAX_LOCATION_LENGTH,
} from '@/server/calendar/service/import/mapper';
import { EventFrequency } from '@/common/model/events';

/**
 * Pure unit tests for the ICS → Pavillion VEVENT mapper (pv-1qcp.2.2).
 *
 * These tests construct VEvent objects directly rather than parsing ICS text.
 * The mapper's contract is "given a VEvent shape from node-ical, produce a
 * Pavillion MapperOutput" — directly building the shape keeps the tests
 * hermetic (no node-ical ESM/CJS interop quirks in the vitest sandbox) and
 * focuses each test on a single mapping rule.
 *
 * Integration tests that exercise the full parse → map chain live alongside
 * the sync orchestrator (pv-1qcp.2.4).
 */

/**
 * Builds a DateWithTimeZone — a plain JS Date with the non-standard `tz`
 * property that node-ical stamps onto DATE-TIME values parsed with a TZID.
 */
function makeDtz(iso: string, tz?: string): DateWithTimeZone {
  const d = new Date(iso) as DateWithTimeZone;
  if (tz !== undefined) {
    d.tz = tz;
  }
  return d;
}

/**
 * Minimal VEvent factory matching the node-ical runtime shape.
 * Keeps each test focused on one mapping rule by defaulting everything else.
 */
function makeVEvent(overrides: Partial<VEvent> = {}): VEvent {
  return {
    type: 'VEVENT',
    uid: 'event-1@example.com',
    dtstamp: makeDtz('2026-03-15T14:00:00Z'),
    start: makeDtz('2026-03-15T14:00:00Z', 'Etc/UTC'),
    end: makeDtz('2026-03-15T15:00:00Z', 'Etc/UTC'),
    datetype: 'date-time',
    summary: 'Test Event',
    ...overrides,
  } as VEvent;
}

describe('ICS mapper: mapVEvent', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  describe('title (SUMMARY)', () => {
    it('maps SUMMARY to content.name verbatim when under limit', () => {
      const vevent = makeVEvent({ summary: 'Community BBQ' });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.content.name).toBe('Community BBQ');
    });

    it('truncates SUMMARY exceeding MAX_TITLE_LENGTH to exactly 512 chars', () => {
      const longTitle = 'A'.repeat(600);
      const vevent = makeVEvent({ summary: longTitle });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.content.name.length).toBe(MAX_TITLE_LENGTH);
      expect(out.content.name).toBe('A'.repeat(MAX_TITLE_LENGTH));
    });

    it('sets content.language to the provided calendarPrimaryLanguage', () => {
      const vevent = makeVEvent({});
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'es' });
      expect(out.content.language).toBe('es');
    });

    it('unwraps a parameterized SUMMARY { val, params } object', () => {
      const vevent = makeVEvent({
        summary: { val: 'Besprechung', params: { LANGUAGE: 'de' } },
      });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'de' });
      expect(out.content.name).toBe('Besprechung');
    });
  });

  describe('UID', () => {
    it('maps UID to external_uid verbatim when under limit', () => {
      const vevent = makeVEvent({ uid: 'abc-123@example.com' });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.external_uid).toBe('abc-123@example.com');
    });

    it('truncates UID exceeding MAX_EXTERNAL_UID_LENGTH to exactly 512 chars', () => {
      const longUid = 'u'.repeat(600);
      const vevent = makeVEvent({ uid: longUid });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.external_uid.length).toBe(MAX_EXTERNAL_UID_LENGTH);
      expect(out.external_uid).toBe('u'.repeat(MAX_EXTERNAL_UID_LENGTH));
    });
  });

  describe('DESCRIPTION + LOCATION', () => {
    it('maps DESCRIPTION to content.description verbatim when no location', () => {
      const vevent = makeVEvent({ description: 'Bring a dish to share' });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.content.description).toBe('Bring a dish to share');
    });

    it('strips HTML tags from DESCRIPTION', () => {
      const vevent = makeVEvent({
        description: 'Hello <b>world</b> <a href="x">link</a>',
      });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.content.description).toBe('Hello world link');
      expect(out.content.description).not.toContain('<');
      expect(out.content.description).not.toContain('>');
    });

    it('decodes common HTML entities in DESCRIPTION', () => {
      const vevent = makeVEvent({
        description: 'A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39;',
      });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.content.description).toBe('A & B <C> "D" \'E\'');
    });

    it('appends non-empty LOCATION to description as "Location: {value}" on new line', () => {
      const vevent = makeVEvent({
        description: 'Bring food',
        location: 'City Park',
      });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.content.description).toBe('Bring food\nLocation: City Park');
    });

    it('produces "Location: {value}" alone when DESCRIPTION is empty', () => {
      const vevent = makeVEvent({ location: 'City Park' });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.content.description).toBe('Location: City Park');
    });

    it('does not append LOCATION when value is empty', () => {
      const vevent = makeVEvent({ description: 'Bring food', location: '' });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.content.description).toBe('Bring food');
      expect(out.content.description).not.toContain('Location:');
    });

    it('does not append LOCATION when value is whitespace only', () => {
      const vevent = makeVEvent({ description: 'Bring food', location: '   ' });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.content.description).toBe('Bring food');
      expect(out.content.description).not.toContain('Location:');
    });

    it('truncates LOCATION to MAX_LOCATION_LENGTH BEFORE appending', () => {
      const longLocation = 'L'.repeat(2000);
      const vevent = makeVEvent({ location: longLocation });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      // "Location: " prefix (10 chars) + 1024 location chars = 1034 chars total.
      expect(out.content.description.length).toBe('Location: '.length + MAX_LOCATION_LENGTH);
      expect(out.content.description.startsWith('Location: ')).toBe(true);
      expect(out.content.description.slice('Location: '.length)).toBe('L'.repeat(MAX_LOCATION_LENGTH));
    });
  });

  describe('URL', () => {
    it('maps URL to external_url when present', () => {
      const vevent = makeVEvent({ url: 'https://example.com/event/1' });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.external_url).toBe('https://example.com/event/1');
    });

    it('sets external_url to null when absent', () => {
      const vevent = makeVEvent({});
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.external_url).toBeNull();
    });

    it('sets external_url to null when URL is empty string', () => {
      const vevent = makeVEvent({ url: '' });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.external_url).toBeNull();
    });
  });

  describe('x_props allowlist', () => {
    // ---- Allowlist: each entry must be retained under a stable output key. ----

    it('retains CATEGORIES under "categories" as a string array', () => {
      const vevent = makeVEvent({});
      (vevent as unknown as Record<string, unknown>).categories = ['music', 'art'];
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.x_props.categories).toEqual(['music', 'art']);
    });

    it('retains GEO under "geo" as { lat, lon }', () => {
      const vevent = makeVEvent({});
      (vevent as unknown as Record<string, unknown>).geo = { lat: 45, lon: -122 };
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.x_props.geo).toEqual({ lat: 45, lon: -122 });
    });

    it('retains X-APPLE-STRUCTURED-LOCATION under the re-prefixed key', () => {
      const vevent = makeVEvent({});
      // CRITICAL — empirical key shape for X-* properties.
      //
      // node-ical strips the leading `X-` from X-* property names but does NOT
      // lowercase the remainder. The relevant parser path lives at
      // `node_modules/node-ical/ical.js:1064-1067`:
      //
      //     if (/X-(?:-|[0-9A-Za-z_])+/v.test(name) && stack.length > 0) {
      //       name = name.slice(2);  // strips 'X-'; no .toLowerCase() call
      //       return storeParameter(name)(value, parameters, ctx, stack, line);
      //     }
      //
      // So `X-APPLE-STRUCTURED-LOCATION` lands in the parsed VEVENT under the
      // uppercase key `APPLE-STRUCTURED-LOCATION`. If we injected the value
      // under a lowercased key here, the mapper's allowlist lookup would miss
      // and this test would pass against a shape the real parser never emits.
      //
      // Exercising the real parser from this test file is blocked by a
      // temporal-polyfill ESM/CJS interop issue in the vitest vmThreads pool
      // (see sync.ts:217-223 for the same constraint in production). Until
      // that has a dedicated integration fixture, this comment is the primary
      // guard: keep it in sync with any future node-ical upgrade.
      const value = {
        val: 'geo:37.7749,-122.4194',
        params: {
          'X-ADDRESS': '1 Market St',
          'X-TITLE': 'HQ',
        },
      };
      (vevent as unknown as Record<string, unknown>)['APPLE-STRUCTURED-LOCATION'] = value;
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.x_props['X-APPLE-STRUCTURED-LOCATION']).toEqual(value);
      // The source key must NOT also be present under the un-prefixed name.
      expect(out.x_props['APPLE-STRUCTURED-LOCATION']).toBeUndefined();
      // Nor under a hypothetical lowercased variant.
      expect(out.x_props['apple-structured-location']).toBeUndefined();
    });

    it('retains CONFERENCE under "conference" with URI and display name', () => {
      const vevent = makeVEvent({});
      const value = {
        val: 'https://meet.example.com/abc',
        params: { FEATURE: 'AUDIO,VIDEO', LABEL: 'Team Standup' },
      };
      (vevent as unknown as Record<string, unknown>).conference = value;
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.x_props.conference).toEqual(value);
    });

    // ---- Drop list: PII, unsafe HTML, and non-allowlisted X-* must be absent. ----

    it('drops ORGANIZER (PII: mailto address)', () => {
      const vevent = makeVEvent({});
      (vevent as unknown as Record<string, unknown>).organizer = {
        val: 'mailto:host@example.com',
        params: { CN: 'Host' },
      };
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.x_props.organizer).toBeUndefined();
      expect(Object.values(out.x_props)).not.toContainEqual({
        val: 'mailto:host@example.com',
        params: { CN: 'Host' },
      });
    });

    it('drops ATTENDEE (PII: mailto addresses)', () => {
      const vevent = makeVEvent({});
      (vevent as unknown as Record<string, unknown>).attendee = [
        { val: 'mailto:a@example.com', params: { CN: 'A' } },
        { val: 'mailto:b@example.com', params: { CN: 'B' } },
      ];
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.x_props.attendee).toBeUndefined();
      // Belt-and-braces: a catch-all regression must not leak the value under
      // an X- prefixed variant either.
      expect(out.x_props['X-ATTENDEE']).toBeUndefined();
    });

    it('drops ATTACH (security-sensitive: arbitrary URL/binary)', () => {
      const vevent = makeVEvent({});
      (vevent as unknown as Record<string, unknown>).attach = {
        val: 'https://example.com/file.pdf',
        params: { FMTTYPE: 'application/pdf' },
      };
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.x_props.attach).toBeUndefined();
      // Belt-and-braces: a catch-all regression must not leak the value under
      // an X- prefixed variant either.
      expect(out.x_props['X-ATTACH']).toBeUndefined();
    });

    it('drops CONTACT (free-form, no target field)', () => {
      const vevent = makeVEvent({});
      (vevent as unknown as Record<string, unknown>).contact = 'Jim Dolittle, ABC Industries, +1-919-555-1234';
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.x_props.contact).toBeUndefined();
      // Belt-and-braces: a catch-all regression must not leak the value under
      // an X- prefixed variant either.
      expect(out.x_props['X-CONTACT']).toBeUndefined();
    });

    it('drops X-ALT-DESC (HTML body; needs sanitizer we don\'t have)', () => {
      const vevent = makeVEvent({});
      // node-ical strips the X- prefix but preserves case on the remainder,
      // so the runtime key is 'ALT-DESC' (uppercase) — not 'alt-desc'. See
      // node_modules/node-ical/ical.js:1064-1067.
      (vevent as unknown as Record<string, unknown>)['ALT-DESC'] = {
        val: '<html><body><b>fancy</b></body></html>',
        params: { FMTTYPE: 'text/html' },
      };
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.x_props['ALT-DESC']).toBeUndefined();
      expect(out.x_props['X-ALT-DESC']).toBeUndefined();
      // Also assert the lowercased shape is absent, guarding against future
      // catch-all regressions that over-match on case variations.
      expect(out.x_props['alt-desc']).toBeUndefined();
    });

    it('drops arbitrary X-* properties not on the allowlist', () => {
      const vevent = makeVEvent({});
      // Two flavors: one that node-ical emits uppercase after X- stripping
      // (X-FOO → FOO, see node_modules/node-ical/ical.js:1064-1067) and one
      // lowercased random extension as a sanity check.
      (vevent as unknown as Record<string, unknown>).FOO = 'should-not-appear';
      (vevent as unknown as Record<string, unknown>)['x-bar'] = 'also-not';
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.x_props.FOO).toBeUndefined();
      expect(out.x_props.foo).toBeUndefined();
      expect(out.x_props['X-FOO']).toBeUndefined();
      expect(out.x_props['x-bar']).toBeUndefined();
      expect(out.x_props['X-BAR']).toBeUndefined();
    });

    it('does not emit mapped standard fields into x_props', () => {
      const vevent = makeVEvent({
        summary: 'T',
        description: 'D',
        location: 'L',
        url: 'https://u/',
      });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      const keys = Object.keys(out.x_props);
      expect(keys).not.toContain('summary');
      expect(keys).not.toContain('description');
      expect(keys).not.toContain('location');
      expect(keys).not.toContain('url');
      expect(keys).not.toContain('uid');
      expect(keys).not.toContain('start');
      expect(keys).not.toContain('end');
      expect(keys).not.toContain('type');
      expect(keys).not.toContain('datetype');
      expect(keys).not.toContain('dtstamp');
    });

    it('returns an empty x_props when no allowlisted properties are present', () => {
      const vevent = makeVEvent({});
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.x_props).toEqual({});
    });
  });

  describe('RRULE', () => {
    it('maps FREQ=DAILY;INTERVAL=2;COUNT=5 correctly', () => {
      const vevent = makeVEvent({
        rrule: {
          options: { freq: 'DAILY', interval: 2, count: 5 },
        } as unknown as VEvent['rrule'],
      });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.schedule.frequency).toBe(EventFrequency.DAILY);
      expect(out.schedule.interval).toBe(2);
      expect(out.schedule.count).toBe(5);
      expect(out.schedule.byDay).toEqual([]);
      expect(out.schedule.endDate).toBeNull();
    });

    it('maps FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10 preserving byDay', () => {
      const vevent = makeVEvent({
        rrule: {
          options: {
            freq: 'WEEKLY',
            interval: 1,
            count: 10,
            byDay: ['MO', 'WE', 'FR'],
          },
        } as unknown as VEvent['rrule'],
      });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.schedule.frequency).toBe(EventFrequency.WEEKLY);
      expect(out.schedule.interval).toBe(1);
      expect(out.schedule.count).toBe(10);
      expect(out.schedule.byDay).toEqual(['MO', 'WE', 'FR']);
    });

    it('maps FREQ=MONTHLY;BYDAY=1MO correctly', () => {
      const vevent = makeVEvent({
        rrule: {
          options: { freq: 'MONTHLY', interval: 1, byDay: ['1MO'] },
        } as unknown as VEvent['rrule'],
      });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.schedule.frequency).toBe(EventFrequency.MONTHLY);
      expect(out.schedule.byDay).toEqual(['1MO']);
    });

    it('maps FREQ=YEARLY;UNTIL=... to endDate (recurrence end boundary)', () => {
      const vevent = makeVEvent({
        rrule: {
          options: {
            freq: 'YEARLY',
            interval: 1,
            until: new Date('2027-12-31T23:59:59Z'),
          },
        } as unknown as VEvent['rrule'],
      });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.schedule.frequency).toBe(EventFrequency.YEARLY);
      expect(out.schedule.endDate).not.toBeNull();
      expect(out.schedule.endDate!.toUTC().year).toBe(2027);
      expect(out.schedule.endDate!.toUTC().month).toBe(12);
      expect(out.schedule.endDate!.toUTC().day).toBe(31);
    });

    it('falls back to rrule options.byweekday when byDay is absent', () => {
      const vevent = makeVEvent({
        rrule: {
          options: {
            freq: 'WEEKLY',
            interval: 1,
            byweekday: ['MO', 'FR'],
          },
        } as unknown as VEvent['rrule'],
      });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.schedule.byDay).toEqual(['MO', 'FR']);
    });

    it('leaves schedule.frequency null when no RRULE present', () => {
      const vevent = makeVEvent({});
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.schedule.frequency).toBeNull();
    });

    it('returns null frequency for unmodelled FREQ values (HOURLY/MINUTELY)', () => {
      const vevent = makeVEvent({
        rrule: {
          options: { freq: 'HOURLY', interval: 1 },
        } as unknown as VEvent['rrule'],
      });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.schedule.frequency).toBeNull();
    });
  });

  describe('EXDATE', () => {
    it('produces one exclusion schedule per distinct EXDATE date', () => {
      const vevent = makeVEvent({
        rrule: {
          options: { freq: 'DAILY', interval: 1, count: 10 },
        } as unknown as VEvent['rrule'],
        // node-ical's dual-key format: both the date-only and ISO keys
        // resolve to the same Date instance.
        exdate: {
          '2026-01-03': makeDtz('2026-01-03T10:00:00Z'),
          '2026-01-03T10:00:00.000Z': makeDtz('2026-01-03T10:00:00Z'),
          '2026-01-05': makeDtz('2026-01-05T10:00:00Z'),
          '2026-01-05T10:00:00.000Z': makeDtz('2026-01-05T10:00:00Z'),
        } as unknown as VEvent['exdate'],
      });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.exclusions.length).toBe(2);
      expect(out.exclusions[0].isExclusion).toBe(true);
      expect(out.exclusions[0].hideFromPublic).toBe(true);
      expect(out.exclusions[1].isExclusion).toBe(true);
      expect(out.exclusions[1].hideFromPublic).toBe(true);
    });

    it('produces no exclusions when EXDATE is absent', () => {
      const vevent = makeVEvent({});
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.exclusions).toEqual([]);
    });
  });

  describe('LAST-MODIFIED', () => {
    it('maps LAST-MODIFIED to source_last_modified as a Luxon DateTime in UTC', () => {
      const vevent = makeVEvent({
        lastmodified: makeDtz('2026-01-01T09:00:00Z'),
      });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.source_last_modified).toBeDefined();
      expect(out.source_last_modified!.toUTC().toISO()).toBe('2026-01-01T09:00:00.000Z');
    });

    it('leaves source_last_modified undefined when absent', () => {
      const vevent = makeVEvent({});
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.source_last_modified).toBeUndefined();
    });
  });

  describe('RECURRENCE-ID', () => {
    it('serializes RECURRENCE-ID into external_recurrence_id (ISO-8601)', () => {
      const vevent = makeVEvent({
        uid: 'parent@example.com',
        recurrenceid: makeDtz('2026-01-03T10:00:00Z'),
        summary: 'Override',
      });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.external_recurrence_id).toBe('2026-01-03T10:00:00.000Z');
    });

    it('leaves external_recurrence_id undefined when RECURRENCE-ID absent', () => {
      const vevent = makeVEvent({});
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.external_recurrence_id).toBeUndefined();
    });
  });

  describe('timezone fallback', () => {
    it('preserves a recognized TZID on DTSTART', () => {
      const vevent = makeVEvent({
        start: makeDtz('2026-06-01T14:00:00Z', 'America/New_York'),
        end: makeDtz('2026-06-01T15:00:00Z', 'America/New_York'),
      });
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.schedule.startDate!.zoneName).toBe('America/New_York');
    });

    it('falls back to calendar X-WR-TIMEZONE when TZID is unrecognized', () => {
      const vevent = makeVEvent({
        start: makeDtz('2026-06-01T14:00:00Z', 'NotAZone/Invalid'),
        end: makeDtz('2026-06-01T15:00:00Z', 'NotAZone/Invalid'),
      });
      const out = mapVEvent({
        vevent,
        calendarPrimaryLanguage: 'en',
        calendarFallbackTimezone: 'America/Los_Angeles',
      });
      expect(out.schedule.startDate!.zoneName).toBe('America/Los_Angeles');
    });

    it('falls back to UTC and emits a warn log when neither TZID nor X-WR-TIMEZONE is recognized', async () => {
      const { default: logger } = await import('@/server/common/helper/logger');
      const warnSpy = sandbox.spy(logger, 'warn');

      const vevent = makeVEvent({
        uid: 'tz-utc-fallback',
        start: makeDtz('2026-06-01T14:00:00Z', 'NotAZone/Invalid'),
        end: makeDtz('2026-06-01T15:00:00Z', 'NotAZone/Invalid'),
      });
      const out = mapVEvent({
        vevent,
        calendarPrimaryLanguage: 'en',
        // intentionally absent: no fallback at all
      });
      expect(out.schedule.startDate!.zoneName).toBe('UTC');
      expect(warnSpy.called).toBe(true);
      const warnArgs = warnSpy.firstCall.args[0] as Record<string, unknown>;
      expect(warnArgs.externalUid).toBe('tz-utc-fallback');
      expect(warnArgs.requestedTzid).toBe('NotAZone/Invalid');
      expect(warnArgs.fallbackTz).toBeNull();
    });

    it('does NOT emit a warn when TZID is recognized', async () => {
      const { default: logger } = await import('@/server/common/helper/logger');
      const warnSpy = sandbox.spy(logger, 'warn');

      const vevent = makeVEvent({
        start: makeDtz('2026-06-01T14:00:00Z', 'America/Chicago'),
        end: makeDtz('2026-06-01T15:00:00Z', 'America/Chicago'),
      });
      mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(warnSpy.called).toBe(false);
    });

    it('does NOT emit a warn when TZID unrecognized but X-WR-TIMEZONE recognized', async () => {
      const { default: logger } = await import('@/server/common/helper/logger');
      const warnSpy = sandbox.spy(logger, 'warn');

      const vevent = makeVEvent({
        start: makeDtz('2026-06-01T14:00:00Z', 'NotAZone/Invalid'),
        end: makeDtz('2026-06-01T15:00:00Z', 'NotAZone/Invalid'),
      });
      mapVEvent({
        vevent,
        calendarPrimaryLanguage: 'en',
        calendarFallbackTimezone: 'America/Los_Angeles',
      });
      expect(warnSpy.called).toBe(false);
    });
  });

  describe('DTSTART / DTEND', () => {
    it('maps DTSTART to schedule.startDate and DTEND to schedule.eventEndTime', () => {
      const vevent = makeVEvent({});
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.schedule.startDate!.toUTC().toISO()).toBe('2026-03-15T14:00:00.000Z');
      expect(out.schedule.eventEndTime!.toUTC().toISO()).toBe('2026-03-15T15:00:00.000Z');
      // endDate is the recurrence UNTIL boundary, not the per-instance end —
      // it must remain null when no RRULE UNTIL is set.
      expect(out.schedule.endDate).toBeNull();
    });

    it('leaves eventEndTime null when DTEND is absent', () => {
      const vevent = makeVEvent({});
      delete (vevent as { end?: unknown }).end;
      const out = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(out.schedule.eventEndTime).toBeNull();
      expect(out.schedule.endDate).toBeNull();
    });

    it('throws when DTSTART is missing', () => {
      const vevent = makeVEvent({});
      delete (vevent as { start?: unknown }).start;
      expect(() => mapVEvent({ vevent, calendarPrimaryLanguage: 'en' })).toThrow(/DTSTART/);
    });
  });

  describe('purity', () => {
    it('returns structurally identical output on repeated calls', () => {
      const vevent = makeVEvent({
        summary: 'S', description: 'D', location: 'L',
      });
      // Use an allowlisted property so x_props equality is non-trivial.
      (vevent as unknown as Record<string, unknown>).categories = ['music', 'art'];
      const a = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      const b = mapVEvent({ vevent, calendarPrimaryLanguage: 'en' });
      expect(a.content.name).toBe(b.content.name);
      expect(a.content.description).toBe(b.content.description);
      expect(a.external_uid).toBe(b.external_uid);
      expect(a.x_props).toEqual(b.x_props);
      expect(a.schedule.startDate!.toMillis()).toBe(b.schedule.startDate!.toMillis());
    });
  });
});
