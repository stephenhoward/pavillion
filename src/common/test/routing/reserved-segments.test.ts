import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

import { getSupportedLanguageCodes, isValidLanguageCode } from '@/common/i18n/languages';
import {
  RESERVED_ROUTE_SEGMENTS,
  classifyReservedRouteSegment,
  isReservedRouteSegment,
} from '@/common/routing/reserved-segments';
import { isClaimableCalendarUrlName } from '@/common/validation/calendarUrlName';
import { buildSiteRoutes } from '@/site/routes';

import { clientRouterTopLevelSegments, topLevelSegment } from './client-routes';
import { serverMountedSegments } from './server-mounts';

const SOURCE_ROOT = path.resolve(__dirname, '../../..');

/**
 * Predicate behaviour and list invariants. `isReservedRouteSegment` and
 * `RESERVED_ROUTE_SEGMENTS` are the subject: membership, case folding, locale
 * delegation, the caller precondition, and the structural guarantees a consumer
 * relies on.
 *
 * How `isClaimableCalendarUrlName` composes this predicate with the shape rule is
 * src/common/test/validation/calendarUrlName.test.ts's job. The one deliberate
 * overlap is the precondition block below, which asserts against both
 * predicates — that pairing is the point of the assertion, not duplication.
 */
describe('reserved route segments', () => {
  describe('server-mounted prefixes', () => {
    // Every top-level segment src/server/** mounts on the Express app today.
    // Asserted exactly, so that a new mount shows up as a diff here.
    const expectedServerSegments = [
      '.well-known',
      'api',
      'assets',
      'calendars',
      'health',
      'users',
    ];

    // src/server/app_routes.ts is exempt from the scan: its paths are RegExp,
    // `new RegExp(...)` and call-built shapes, whose dispositions are pinned
    // over HTTP in src/server/common/test/app_routes.test.ts and by stack walk
    // in public-url-contract.test.ts. These are the segments it serves itself.
    const pageRouterSegments = ['coverage', 'widget'];

    it('reads every mount path in the server', () => {
      const { unparseable } = serverMountedSegments();

      expect(
        unparseable,
        'src/server declares mount paths this test cannot read as string literals, '
        + 'so their segments are unchecked. Extend serverMountedSegments in server-mounts.ts to cover: '
        + unparseable.join(' | '),
      ).toEqual([]);
    });

    it('sees exactly the top-level segments the server mounts', () => {
      const { segments } = serverMountedSegments();

      expect(segments).toEqual(expectedServerSegments);
    });

    it('reserves every top-level segment the server mounts', () => {
      const { segments } = serverMountedSegments();

      const unreserved = segments.filter(segment => !isReservedRouteSegment(segment));
      expect(unreserved).toEqual([]);
    });

    it.each(pageRouterSegments)('reserves the page router segment %s', (segment) => {
      expect(isReservedRouteSegment(segment)).toBe(true);
    });

    // Deliberately excluded: DEC-017 serves the telemetry exposition from a
    // second HTTP listener, so it claims no path on the main Express app.
    // Reserving it would only become correct if that decision were overturned.
    it('leaves metrics available, since it lives on the second listener', () => {
      expect(isReservedRouteSegment('metrics')).toBe(false);
    });
  });

  describe('client SPA routes', () => {
    // Every top-level segment src/client/routes.ts owns today. Asserted exactly, so
    // that a route added there shows up as a diff here rather than slipping past
    // a loose count.
    const expectedRouterSegments = [
      'auth',
      'calendar',
      'event',
      'feed',
      'inbox',
      'login',
      'policy',
      'settings',
      'setup',
    ];

    it('reads every path in the client router', () => {
      const { unparseable } = clientRouterTopLevelSegments();

      expect(
        unparseable,
        'src/client/routes.ts declares route paths this test cannot read as string literals, '
        + 'so their segments are unchecked. Extend topLevelSegmentsOf in client-routes.ts to cover: '
        + unparseable.join(' | '),
      ).toEqual([]);
    });

    it('sees exactly the top-level segments the client router owns', () => {
      const { segments } = clientRouterTopLevelSegments();

      expect([...segments].sort()).toEqual(expectedRouterSegments);
    });

    it('reserves every top-level segment the client router owns', () => {
      const { segments } = clientRouterTopLevelSegments();

      const unreserved = segments.filter(segment => !isReservedRouteSegment(segment));
      expect(unreserved).toEqual([]);
    });
  });

  describe('public site routes', () => {
    // Read from the real site route table, bound to stub components.
    const StubComponent = { template: '<div />' };
    const siteSegments = [...new Set(
      buildSiteRoutes({
        discovery: StubComponent,
        calendar: StubComponent,
        event: StubComponent,
        instance: StubComponent,
        series: StubComponent,
      })
        .map(route => topLevelSegment(route.path))
        .filter((segment): segment is string => segment !== null),
    )];

    it('sees exactly the static top-level segments the site router owns', () => {
      expect(siteSegments.sort()).toEqual(['discover']);
    });

    it('reserves every static top-level segment the site router owns', () => {
      const unreserved = siteSegments.filter(segment => !isReservedRouteSegment(segment));
      expect(unreserved).toEqual([]);
    });

    it('reserves view permanently so the redirects stay unambiguous', () => {
      expect(isReservedRouteSegment('view')).toBe(true);
    });
  });

  describe('locale codes', () => {
    it.each(getSupportedLanguageCodes())('reserves the locale prefix %s', (code) => {
      expect(isReservedRouteSegment(code)).toBe(true);
    });

    it('reserves a locale code the segment list does not itself name', () => {
      expect(RESERVED_ROUTE_SEGMENTS).not.toContain('es');
      expect(isReservedRouteSegment('es')).toBe(true);
    });
  });

  describe('comparison rules', () => {
    it.each(['Admin', 'VIEW', 'Es'])('matches %s case-insensitively', (segment) => {
      expect(isReservedRouteSegment(segment)).toBe(true);
    });

    it.each(['my-calendar', 'community_events', 'admins', 'viewpoint', 'my-admin', 'healthy'])(
      'leaves the ordinary name %s available',
      (name) => {
        expect(isReservedRouteSegment(name)).toBe(false);
      },
    );

    it('treats an empty segment as unreserved', () => {
      expect(isReservedRouteSegment('')).toBe(false);
    });

    // The caller precondition, pinned: the argument must already be decoded and
    // validated against CALENDAR_URL_NAME_RE, which rejects all three of these.
    // A router that checks reservations against a raw Express pathname would
    // read these answers as permission to route them to a calendar.
    it.each(['%61dmin', ' admin', 'admin.'])(
      'does not decode, trim, or normalize %o',
      (segment) => {
        expect(isReservedRouteSegment(segment)).toBe(false);
        expect(isClaimableCalendarUrlName(segment)).toBe(false);
      },
    );
  });

  describe('the segment list itself', () => {
    // The module holds two collections: this frozen public array and the
    // module-private Set copied from it. Driving the predicate from the array is
    // what catches the two disagreeing.
    it.each([...RESERVED_ROUTE_SEGMENTS])('reserves the listed segment %s', (segment) => {
      expect(isReservedRouteSegment(segment)).toBe(true);
    });

    // The module reserves locale codes by delegating to isValidLanguageCode
    // rather than listing them, so the list cannot drift from the supported
    // languages. classifyReservedRouteSegment reads the two sets as disjoint:
    // it tests the list first, so a name that is both listed and a locale code
    // would be labelled 'reserved_segment' and never 'locale_code'. Nothing
    // else enforces it, and it holds today only incidentally (every supported
    // code is two characters, every entry three or more), so a longer code such
    // as 'pt-br' could break it silently.
    it('names no supported language code, so the two reservation sources stay disjoint', () => {
      const localeEntries = RESERVED_ROUTE_SEGMENTS.filter(segment => isValidLanguageCode(segment));

      expect(localeEntries).toEqual([]);
    });

    it('holds only lower-case entries', () => {
      const uppercased = RESERVED_ROUTE_SEGMENTS.filter(segment => segment !== segment.toLowerCase());

      expect(uppercased).toEqual([]);
    });

    // pv-l04s.2.2 builds a router regex alternation from this list. ReadonlyArray
    // is a compile-time claim only; the freeze is what makes it true at runtime.
    it('cannot be mutated at runtime', () => {
      const before = [...RESERVED_ROUTE_SEGMENTS];
      const mutable = RESERVED_ROUTE_SEGMENTS as string[];

      expect(Object.isFrozen(RESERVED_ROUTE_SEGMENTS)).toBe(true);
      expect(() => mutable.push('evil')).toThrow(TypeError);
      expect(() => { mutable[0] = 'evil'; }).toThrow(TypeError);
      expect(() => { mutable.length = 0; }).toThrow(TypeError);
      expect([...RESERVED_ROUTE_SEGMENTS]).toEqual(before);
    });

    it('imports nothing app-specific, since client, site, and server all use it', () => {
      const source = readFileSync(path.join(SOURCE_ROOT, 'common/routing/reserved-segments.ts'), 'utf-8');
      const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map(match => match[1]);

      expect(imports.filter(specifier => /^@\/(server|client|site|widget)\//.test(specifier))).toEqual([]);
    });
  });
});

/**
 * The classifier is the single implementation of the reserved/locale split;
 * `isReservedRouteSegment` is derived from it. These tests pin which reason each
 * kind of segment carries, and that the predicate agrees with it.
 */
describe('classifyReservedRouteSegment', () => {
  it.each([...RESERVED_ROUTE_SEGMENTS])('classifies the listed segment %s as reserved_segment', (segment) => {
    expect(classifyReservedRouteSegment(segment)).toBe('reserved_segment');
  });

  it.each(getSupportedLanguageCodes())('classifies the locale code %s as locale_code', (code) => {
    expect(classifyReservedRouteSegment(code)).toBe('locale_code');
  });

  it.each(['Admin', 'VIEW'])('folds case on the listed segment %s', (segment) => {
    expect(classifyReservedRouteSegment(segment)).toBe('reserved_segment');
  });

  it('folds case on a locale code', () => {
    expect(classifyReservedRouteSegment('Es')).toBe('locale_code');
  });

  it.each(['my-calendar', 'admins', ''])('returns null for the unreserved name %o', (name) => {
    expect(classifyReservedRouteSegment(name)).toBeNull();
  });

  // Same caller precondition as the predicate: no decoding, trimming, or
  // normalization beyond case folding.
  it.each(['%61dmin', ' admin', 'admin.'])('does not decode, trim, or normalize %o', (segment) => {
    expect(classifyReservedRouteSegment(segment)).toBeNull();
  });

  it('agrees with isReservedRouteSegment on every sampled segment', () => {
    const sample = [
      ...RESERVED_ROUTE_SEGMENTS,
      ...getSupportedLanguageCodes(),
      'Admin',
      'Es',
      'my-calendar',
      'admins',
      'viewpoint',
      '',
      '%61dmin',
    ];

    for (const segment of sample) {
      expect(isReservedRouteSegment(segment), segment).toBe(classifyReservedRouteSegment(segment) !== null);
    }
  });
});
