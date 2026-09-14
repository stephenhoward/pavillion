import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

import { getDefaultEnabledLanguageCodes } from '@/common/i18n/languages';
import { RESERVED_ROUTE_SEGMENTS, isReservedRouteSegment } from '@/common/routing/reserved-segments';

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
 */
function clientRouterTopLevelSegments(): string[] {
  const source = readFileSync(path.join(SOURCE_ROOT, 'client/app.ts'), 'utf-8');
  const declaration = 'const routes: RouteRecordRaw[] = [';
  const arrayStart = source.indexOf(declaration) + declaration.length - 1;

  const segments = new Set<string>();
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
      if (!match) continue;

      if (braceDepth === 1) {
        enclosingPath = match[1];
      }
      if (braceDepth === 1 || (braceDepth === 2 && enclosingPath === '/')) {
        const segment = topLevelSegment(match[1]);
        if (segment) segments.add(segment);
      }
    }
  }

  return [...segments];
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
  });

  describe('client SPA routes', () => {
    it('reserves every top-level segment the client router owns', () => {
      const routerSegments = clientRouterTopLevelSegments();

      expect(routerSegments).toContain('admin');
      expect(routerSegments).toContain('calendar');
      expect(routerSegments.length).toBeGreaterThan(5);

      const unreserved = routerSegments.filter(segment => !isReservedRouteSegment(segment));
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
      expect(RESERVED_ROUTE_SEGMENTS.has('es')).toBe(false);
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
  });

  describe('the segment list itself', () => {
    it('holds only lower-case entries', () => {
      const uppercased = [...RESERVED_ROUTE_SEGMENTS].filter(segment => segment !== segment.toLowerCase());

      expect(uppercased).toEqual([]);
    });

    it('imports nothing app-specific, since client, site, and server all use it', () => {
      const source = readFileSync(path.join(SOURCE_ROOT, 'common/routing/reserved-segments.ts'), 'utf-8');
      const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map(match => match[1]);

      expect(imports.filter(specifier => /^@\/(server|client|site|widget)\//.test(specifier))).toEqual([]);
    });
  });
});
