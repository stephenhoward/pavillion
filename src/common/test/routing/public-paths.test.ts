/**
 * Unit coverage for the shared public-path builders.
 *
 * These assertions pin the SHAPE in isolation — that the builders are pure,
 * root-relative, locale-free and origin-free, and that they encode. Whether the
 * shape they emit is one the server serves and the site SPA can match is a
 * different question, answered by joining them against both real route tables
 * in src/common/test/routing/public-url-contract.test.ts. Neither file
 * substitutes for the other: this one would stay green if every route moved,
 * that one would stay green if the builders drifted from the callers.
 */
import { describe, it, expect } from 'vitest';

import { isValidLanguageCode } from '@/common/i18n/languages';
import {
  DISCOVER_PATH,
  calendarPath,
  eventPath,
  seriesPath,
} from '@/common/routing/public-paths';

describe('public path builders', () => {
  describe('DISCOVER_PATH', () => {
    it('is the root-relative discovery path', () => {
      expect(DISCOVER_PATH).toBe('/discover');
    });
  });

  describe('calendarPath', () => {
    it('puts a calendar at the domain root', () => {
      expect(calendarPath('mycalendar')).toBe('/mycalendar');
    });

    it('preserves the characters a valid url name may contain', () => {
      expect(calendarPath('my_cal-2')).toBe('/my_cal-2');
    });

    it('percent-encodes a segment that would otherwise escape its position', () => {
      expect(calendarPath('a/../admin')).toBe('/a%2F..%2Fadmin');
      expect(calendarPath('cal?x=1')).toBe('/cal%3Fx%3D1');
    });

    // Pins the escape properties the module doc rests on, not just the output
    // shape — a regression from encodeURIComponent to encodeURI would still
    // produce a leading '/' and would still pass every other test above.
    it('never emits a scheme-relative authority, because "/" is always encoded', () => {
      const path = calendarPath('//evil.com');

      expect(path).toBe('/%2F%2Fevil.com');
      expect(path.startsWith('//')).toBe(false);
    });

    it('encodes a leading backslash, so a WHATWG relative-slash-state parser cannot read it as an authority separator', () => {
      // app_routes.ts documents a percent-decoding reverse proxy as a reachable
      // topology, so an input that is a literal backslash here is not a
      // hypothetical — see toSameOriginPath and its doc comment there.
      expect(calendarPath('\\evil.com')).toBe('/%5Cevil.com');
    });

    it('leaves ".." unencoded, because the safety argument rests on "/" being encoded, not on the dots', () => {
      expect(calendarPath('..')).toBe('/..');
    });
  });

  describe('eventPath', () => {
    it('nests an event under its calendar', () => {
      expect(eventPath('mycalendar', 'event-123')).toBe('/mycalendar/events/event-123');
    });

    it('appends the occurrence slug when one is given', () => {
      expect(eventPath('mycalendar', 'event-123', '20260508-1400'))
        .toBe('/mycalendar/events/event-123/20260508-1400');
    });

    it('yields the event page for an empty slug rather than a trailing slash', () => {
      expect(eventPath('mycalendar', 'event-123', '')).toBe('/mycalendar/events/event-123');
    });

    it('percent-encodes every dynamic segment', () => {
      expect(eventPath('my cal', 'a/b', 'x y')).toBe('/my%20cal/events/a%2Fb/x%20y');
    });

    it('cannot reach a sibling calendar through a dotted event id, because ".." has no "/" to traverse with', () => {
      expect(eventPath('cal', '..')).toBe('/cal/events/..');
    });
  });

  describe('seriesPath', () => {
    it('nests a series under its calendar', () => {
      expect(seriesPath('mycalendar', 'weekly-standup'))
        .toBe('/mycalendar/series/weekly-standup');
    });

    it('percent-encodes every dynamic segment', () => {
      expect(seriesPath('my cal', 'a/b')).toBe('/my%20cal/series/a%2Fb');
    });
  });

  // The three things a caller may assume about every builder. Stated as one
  // table so a builder added later has to be added here too.
  describe('what every builder guarantees its callers', () => {
    const emitted = [
      ['DISCOVER_PATH', DISCOVER_PATH],
      ['calendarPath', calendarPath('mycalendar')],
      ['eventPath', eventPath('mycalendar', 'event-123')],
      ['eventPath (instance)', eventPath('mycalendar', 'event-123', '20260508-1400')],
      ['seriesPath', seriesPath('mycalendar', 'weekly-standup')],
    ] as const;

    it('emits a root-relative path, never an absolute URL', () => {
      const observed = emitted.map(([name, path]) => [name, path.startsWith('/'), path.includes('://')]);

      expect(observed).toEqual(emitted.map(([name]) => [name, true, false]));
    });

    // The site SPA's locale-prefixed routes are '/:locale(es|fr|…)/…', so a
    // builder that emitted a prefix of its own would double it up once
    // useLocale.localizedPath wrapped the result.
    it('emits no locale prefix — localizedPath adds one on the site', () => {
      const observed = emitted.map(([name, path]) => [name, isValidLanguageCode(path.split('/')[1])]);

      expect(observed).toEqual(emitted.map(([name]) => [name, false]));
    });
  });
});
