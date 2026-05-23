import { describe, it, expect } from 'vitest';
import {
  DOCS_BASE,
  docsUrl,
  browseAllUrl,
  guidesForRoute,
  audienceForRoute,
  ROUTE_GUIDES,
} from '@/client/service/docs';
import enSystem from '@/client/locales/en/system.json';

const enGuides = (enSystem as { help: { guides: Record<string, { label: string; description: string }> } }).help.guides;

describe('docsUrl', () => {
  it('builds a URL on the public docs host with no extension', () => {
    expect(docsUrl('guides/calendar-owners/quickstart'))
      .toBe('https://docs.pavillion.social/guides/calendar-owners/quickstart');
  });

  it('uses the canonical docs base', () => {
    expect(DOCS_BASE).toBe('https://docs.pavillion.social');
  });

  it('does not append .html (docs site uses cleanUrls)', () => {
    expect(docsUrl('guides/calendar-owners/quickstart')).not.toMatch(/\.html$/);
  });
});

describe('browseAllUrl', () => {
  it('returns the calendar-owners landing page URL', () => {
    expect(browseAllUrl('calendar-owners'))
      .toBe('https://docs.pavillion.social/guides/calendar-owners');
  });

  it('returns the instance-administrators landing page URL', () => {
    expect(browseAllUrl('instance-administrators'))
      .toBe('https://docs.pavillion.social/guides/instance-administrators');
  });
});

describe('guidesForRoute', () => {
  it('returns the documented guides for a known calendar-owner route', () => {
    const guides = guidesForRoute('calendars');
    expect(guides.length).toBeGreaterThan(0);
    expect(guides[0].slug).toBe('guides/calendar-owners/quickstart');
    expect(guides[0].key).toBe('quickstart');
  });

  it('returns the documented guides for a known admin route', () => {
    const guides = guidesForRoute('federation');
    expect(guides.map(g => g.slug)).toContain(
      'guides/instance-administrators/how-federation-works-for-admins',
    );
  });

  it('returns an empty array for an unknown route name', () => {
    expect(guidesForRoute('not_a_real_route')).toEqual([]);
  });

  it('returns an empty array for null', () => {
    expect(guidesForRoute(null)).toEqual([]);
  });

  it('returns an empty array for undefined', () => {
    expect(guidesForRoute(undefined)).toEqual([]);
  });

  it('returns an empty array for a symbol route name', () => {
    expect(guidesForRoute(Symbol('anon'))).toEqual([]);
  });
});

describe('audienceForRoute', () => {
  it('classifies known admin routes as instance-administrators', () => {
    expect(audienceForRoute('federation')).toBe('instance-administrators');
    expect(audienceForRoute('moderation')).toBe('instance-administrators');
    expect(audienceForRoute('admin_settings')).toBe('instance-administrators');
  });

  it('classifies calendar-owner routes as calendar-owners', () => {
    expect(audienceForRoute('calendars')).toBe('calendar-owners');
    expect(audienceForRoute('event_edit')).toBe('calendar-owners');
  });

  it('defaults unknown or non-string inputs to calendar-owners', () => {
    expect(audienceForRoute('not_a_real_route')).toBe('calendar-owners');
    expect(audienceForRoute(undefined)).toBe('calendar-owners');
    expect(audienceForRoute(Symbol('x') as never)).toBe('calendar-owners');
  });
});

describe('ROUTE_GUIDES referential integrity', () => {
  const referencedKeys = new Set(
    Object.values(ROUTE_GUIDES).flatMap(guides => guides.map(g => g.key)),
  );

  it('every referenced guide key has a label and description in en/system.json', () => {
    const missing: string[] = [];
    for (const key of referencedKeys) {
      const entry = enGuides[key];
      if (!entry || typeof entry.label !== 'string' || typeof entry.description !== 'string') {
        missing.push(key);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every guide entry in en/system.json is referenced by at least one route', () => {
    const orphaned = Object.keys(enGuides).filter(key => !referencedKeys.has(key));
    expect(orphaned).toEqual([]);
  });

  it('every guide slug points under /guides/ on the docs site', () => {
    const badSlugs: string[] = [];
    for (const guides of Object.values(ROUTE_GUIDES)) {
      for (const g of guides) {
        if (!g.slug.startsWith('guides/calendar-owners/') && !g.slug.startsWith('guides/instance-administrators/')) {
          badSlugs.push(g.slug);
        }
      }
    }
    expect(badSlugs).toEqual([]);
  });
});
