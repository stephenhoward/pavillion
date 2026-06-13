import { describe, it, expect } from 'vitest';
import config from 'config';
import { DateTime } from 'luxon';

import { Calendar } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventContent, CalendarEventSchedule } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';
import { NoteObject } from '@/server/activitypub/model/object/note';

const startDt = DateTime.fromISO('2026-06-15T18:30:00.000Z');

const domain = config.get<string>('domain');

/**
 * XSS regression suite for the OUTBOUND Note rendering path (pv-dzy3).
 *
 * Config under test: `NoteObject.toActivityPubObject` in
 * `src/server/activitypub/model/object/note.ts`. The Note is the ONE place in
 * AP serialization where Pavillion EMITS HTML (a `<p><a href>…</a></p>`
 * paragraph) for Mastodon-class consumers that render Note content verbatim.
 *
 * NoteObject has NO `fromActivityPubObject` — Pavillion never ingests remote
 * Notes (note.ts:45-47). So unlike the EventObject strip path, the threat here
 * is not inbound markup smuggling; it is OUTBOUND template injection. If a
 * locally-stored event title or location name contained HTML/quote characters
 * and were interpolated raw into the content string, a malicious value could
 * break out of the anchor and inject markup into a downstream renderer.
 *
 * The defense is `he.encode` applied to title, href, and location before
 * interpolation (note.ts:144-151,159). These fixtures lock that contract: a
 * title/location/override-URL carrying `<`, `"`, or `>` must appear ONLY in
 * encoded form, never as a live tag, attribute break-out, or quote break-out.
 *
 * The anchor href is additionally constrained by `sanitizeExternalUrlHref` on
 * the urlOverride path (rejects non-http(s) schemes); that scheme validator is
 * tested in note.test.ts. Here we cover the he.encode escaping layer.
 */

/**
 * A Note content string is safe when injected payload chars appear only in
 * he.encode'd form — i.e. no RAW angle bracket introduces a tag beyond
 * Pavillion's own wrapper. Once every `<`/`>`/`"` from user content is encoded
 * to `&#x3C;`/`&#x3E;`/`&#x22;`, a residual literal `onerror=alert(1)` is inert
 * text, not a live attribute, because there is no live element to host it. So
 * the load-bearing assertion is the absence of an unexpected raw tag token; the
 * handler check is anchored to live `<…>` runs only, not to bare text.
 */
function expectNoLiveBreakout(html: string): void {
  // Strip Pavillion's known-good wrapper tags, then assert no other RAW tag
  // token remains. he.encode'd payload (&#x3C;img…) is text, not a tag, so it
  // is correctly not matched here.
  const withoutWrapper = html
    .replace(/<p>/g, '')
    .replace(/<\/p>/g, '')
    .replace(/<a href="[^"]*">/g, '')
    .replace(/<\/a>/g, '');
  expect(withoutWrapper).not.toMatch(/<[a-z!/]/i);
  // No event handler hosted inside a residual live tag run. Anchored to a
  // raw `<…on*=` sequence so encoded payload text (which can legitimately
  // contain the literal `onerror=`) does not false-positive.
  expect(withoutWrapper).not.toMatch(/<[^>]*\son\w+\s*=/i);
}

function buildEvent(title: string, opts: { locationName?: string } = {}): { calendar: Calendar; event: CalendarEvent } {
  const calendar = new Calendar('cal-uuid', 'mycal');
  const event = new CalendarEvent('event-uuid', 'cal-uuid');
  event.addContent(new CalendarEventContent('en', title, ''));
  event.schedules = [new CalendarEventSchedule('s1', startDt)];
  event.date = '2026-06-15';
  if (opts.locationName !== undefined) {
    event.location = new EventLocation('loc-uuid', opts.locationName);
  }
  return { calendar, event };
}

describe('NoteObject.toActivityPubObject — outbound template-injection escaping', () => {

  // ---------------------------------------------------------------------------
  // Positive control: benign content renders the expected wrapper + readable
  // text so the negative assertions below are trustworthy.
  // ---------------------------------------------------------------------------
  it('positive control: benign title and location render readable, wrapped content', () => {
    const { calendar, event } = buildEvent('Coffee Meetup', { locationName: 'Riverside Park' });
    const result = new NoteObject(calendar, event).toActivityPubObject();

    expect(result.content).toContain('<a href=');
    expect(result.content).toContain('Coffee Meetup');
    expect(result.content).toContain('Riverside Park');
    expect(result.name).toBe('Coffee Meetup');
    expectNoLiveBreakout(result.content);
  });

  describe('title escaping (name and content fields)', () => {
    const titleVectors: Array<{ name: string; title: string }> = [
      { name: 'script tag in title', title: '<script>alert(1)</script>Party' },
      { name: 'img onerror in title', title: '<img src=x onerror=alert(1)>Gala' },
      { name: 'attribute break-out via quote', title: 'Show"><img src=x onerror=alert(1)>' },
      { name: 'angle brackets only', title: 'A < B > C' },
    ];
    for (const { name, title } of titleVectors) {
      it(`encodes title: ${name}`, () => {
        const { calendar, event } = buildEvent(title);
        const result = new NoteObject(calendar, event).toActivityPubObject();

        // name field is he.encode'd directly.
        expect(result.name).not.toMatch(/<[a-z!/]/i);
        // content paragraph carries no live break-out beyond the wrapper.
        expectNoLiveBreakout(result.content);
        // The dangerous '<' is present only in encoded form within content —
        // a raw '<script' / '<img' tag token never appears. (A residual
        // literal 'onerror=' inside encoded text is inert: its host tag's
        // angle brackets are encoded, so there is no live attribute.)
        expect(result.content).not.toContain('<script');
        expect(result.content).not.toContain('<img');
      });
    }
  });

  describe('location escaping (content field)', () => {
    it('encodes a malicious location name in the content segment', () => {
      const { calendar, event } = buildEvent('Benign Title', {
        locationName: '<img src=x onerror=alert(1)>Hall',
      });
      const result = new NoteObject(calendar, event).toActivityPubObject();

      expectNoLiveBreakout(result.content);
      // Raw tag token never appears; the payload is encoded to inert text.
      expect(result.content).not.toContain('<img');
    });

    it('encodes a quote-breakout location name', () => {
      const { calendar, event } = buildEvent('Benign Title', {
        locationName: 'Room"><script>alert(1)</script>',
      });
      const result = new NoteObject(calendar, event).toActivityPubObject();

      expectNoLiveBreakout(result.content);
      expect(result.content).not.toContain('<script');
    });
  });

  describe('multi-language contentMap escaping', () => {
    it('encodes malicious titles in every contentMap/nameMap language entry', () => {
      const calendar = new Calendar('cal-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'cal-uuid');
      event.addContent(new CalendarEventContent('en', '<script>en</script>English', ''));
      event.addContent(new CalendarEventContent('es', 'Show"><img src=x onerror=alert(1)>', ''));
      event.schedules = [new CalendarEventSchedule('s1', startDt)];
      event.date = '2026-06-15';

      const result = new NoteObject(calendar, event).toActivityPubObject();

      expect(result.nameMap.en).not.toMatch(/<[a-z!/]/i);
      expect(result.nameMap.es).not.toMatch(/<[a-z!/]/i);
      expectNoLiveBreakout(result.contentMap.en);
      expectNoLiveBreakout(result.contentMap.es);
      // Raw tag tokens never appear in either language's content.
      expect(result.contentMap.en).not.toContain('<script');
      expect(result.contentMap.es).not.toContain('<img');
    });
  });

  describe('anchor href escaping (urlOverride path)', () => {
    it('rejects a non-http(s) override scheme, falling back to the local href', () => {
      const { calendar, event } = buildEvent('Title');
      // sanitizeExternalUrlHref rejects javascript: — url is omitted and the
      // anchor href falls back to the local event page (no scheme break-out).
      const result = new NoteObject(calendar, event, {
        urlOverride: 'javascript:alert(1)',
      }).toActivityPubObject();

      expect(result).not.toHaveProperty('url');
      expect(result.content).not.toContain('javascript:');
      expect(result.content).toContain(`href="https://${domain}/calendars/mycal/events/event-uuid"`);
      expectNoLiveBreakout(result.content);
    });
  });
});
