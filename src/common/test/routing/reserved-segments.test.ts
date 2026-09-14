import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

import { getDefaultEnabledLanguageCodes } from '@/common/i18n/languages';
import { RESERVED_ROUTE_SEGMENTS, isReservedRouteSegment } from '@/common/routing/reserved-segments';
import { isValidCalendarUrlName } from '@/common/validation/calendarUrlName';

const SOURCE_ROOT = path.resolve(__dirname, '../../..');

/**
 * Reduces a vue-router path to the static top-level segment it claims.
 * Returns null for the root path, empty child paths, and dynamic segments,
 * none of which claim a name a calendar could otherwise use.
 */
function topLevelSegment(routePath: string): string | null {
  const segment = routePath.replace(/^\//, '').split('/')[0];

  if (segment === '' || segment.startsWith(':')) {
    return null;
  }
  return segment;
}

/**
 * Extracts the top-level URL segments the client SPA router owns by reading its
 * source, so a route added to src/client/app.ts without a matching reservation
 * fails here instead of silently shadowing a calendar of the same name.
 *
 * Route objects sitting directly in the `routes` array are top level. So are the
 * children of the route whose own path is '/', because they mount directly
 * beneath the root rather than under a namespace of their own.
 *
 * Only a plain single-quoted string literal can be read. Anything else — a
 * template literal, a double-quoted string, a computed expression — is returned
 * in `unparseable` rather than skipped, because a path this reader cannot see is
 * a segment it cannot check, and silence there is indistinguishable from
 * success. A failure means the reader needs extending, not that the route is
 * wrong.
 */
function clientRouterTopLevelSegments(): { segments: string[], unparseable: string[] } {
  const source = readFileSync(path.join(SOURCE_ROOT, 'client/app.ts'), 'utf-8');
  const declaration = 'const routes: RouteRecordRaw[] = [';
  const arrayStart = source.indexOf(declaration) + declaration.length - 1;

  const segments = new Set<string>();
  const unparseable: string[] = [];
  const pathLiteral = /^path:\s*'([^']*)'/;
  let bracketDepth = 0;
  let braceDepth = 0;
  let enclosingPath = '';

  for (let index = arrayStart; index < source.length; index++) {
    const character = source[index];

    if (character === '[') {
      bracketDepth++;
    }
    else if (character === ']') {
      bracketDepth--;
      if (bracketDepth === 0) break;
    }
    else if (character === '{') {
      braceDepth++;
    }
    else if (character === '}') {
      braceDepth--;
    }
    else if (source.startsWith('path:', index)) {
      const match = pathLiteral.exec(source.slice(index));

      if (!match) {
        const lineEnd = source.indexOf('\n', index);
        const expression = source.slice(index, lineEnd === -1 ? source.length : lineEnd).trim();

        unparseable.push(expression.replace(/,$/, ''));
        continue;
      }

      if (braceDepth === 1) {
        enclosingPath = match[1];
      }
      if (braceDepth === 1 || (braceDepth === 2 && enclosingPath === '/')) {
        const segment = topLevelSegment(match[1]);
        if (segment) segments.add(segment);
      }
    }
  }

  return { segments: [...segments], unparseable };
}

describe('reserved route segments', () => {
  describe('server-mounted prefixes', () => {
    // Enumerated from the client catch-all exclusions and the asset/coverage
    // redirects in src/server/app_routes.ts, the federation routers mounted at
    // '/' in src/server/activitypub/api/v1.ts, and /health in src/server/server.ts.
    const serverSegments = [
      '.well-known',
      'api',
      'assets',
      'calendars',
      'coverage',
      'health',
      'users',
      'widget',
    ];

    it.each(serverSegments)('reserves %s', (segment) => {
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
    // Every top-level segment src/client/app.ts owns today. Asserted exactly, so
    // that a route added there shows up as a diff here rather than slipping past
    // a loose count.
    const expectedRouterSegments = [
      'admin',
      'auth',
      'calendar',
      'event',
      'feed',
      'funding',
      'inbox',
      'login',
      'policy',
      'profile',
      'setup',
    ];

    it('reads every path in the client router', () => {
      const { unparseable } = clientRouterTopLevelSegments();

      expect(
        unparseable,
        `src/client/app.ts declares route paths this test cannot read as plain '…' string literals, `
        + 'so their segments are unchecked. Extend clientRouterTopLevelSegments to cover: '
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
    it('reserves the discovery page', () => {
      expect(isReservedRouteSegment('discover')).toBe(true);
    });

    it('reserves view permanently so the redirects stay unambiguous', () => {
      expect(isReservedRouteSegment('view')).toBe(true);
    });
  });

  describe('locale codes', () => {
    it.each(getDefaultEnabledLanguageCodes())('reserves the locale prefix %s', (code) => {
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

    it.each(['my-calendar', 'community_events', 'admins', 'viewpoint'])(
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
        expect(isValidCalendarUrlName(segment)).toBe(false);
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
