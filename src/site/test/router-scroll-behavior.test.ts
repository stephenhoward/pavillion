/**
 * Tests for the site router's scroll behavior.
 *
 * Event cards navigate inside the SPA rather than reloading the document, so
 * the router — not the browser — decides where the window lands. These tests
 * pin the rule against the shipped route table: a new view starts at the top
 * (as the old full reload did), back/forward restores the saved position, and
 * a navigation that stays on the same view leaves the scroll alone.
 */
import { describe, it, expect } from 'vitest';
import { createRouter, createMemoryHistory } from 'vue-router';

import { buildSiteRoutes, siteScrollBehavior } from '@/site/routes';

// Distinct stubs per view: the rule compares view identity, so sharing one
// stub across every route would make every navigation look like "same view".
const router = createRouter({
  history: createMemoryHistory(),
  routes: buildSiteRoutes({
    discovery: { template: '<div>discovery</div>' },
    calendar: { template: '<div>calendar</div>' },
    event: { template: '<div>event</div>' },
    instance: { template: '<div>instance</div>' },
    series: { template: '<div>series</div>' },
  }),
});

/**
 * Evaluate the scroll behavior for a navigation between two site paths.
 */
function scrollFor(fromPath: string, toPath: string, savedPosition: { left: number; top: number } | null = null) {
  const from = router.resolve(fromPath);
  const to = router.resolve(toPath);
  return siteScrollBehavior(to, from as any, savedPosition);
}

describe('siteScrollBehavior', () => {
  it('should start at the top when a calendar event card opens an event instance page', () => {
    expect(scrollFor('/mycal', '/mycal/events/evt-1/20260610-1200')).toEqual({ top: 0 });
  });

  it('should start at the top for a locale-prefixed calendar-to-instance navigation', () => {
    expect(scrollFor('/es/mycal', '/es/mycal/events/evt-1/20260610-1200')).toEqual({ top: 0 });
  });

  it('should start at the top when discovery opens a calendar', () => {
    expect(scrollFor('/discover', '/mycal')).toEqual({ top: 0 });
  });

  it('should restore the saved position on back/forward', () => {
    const saved = { left: 0, top: 840 };
    expect(scrollFor('/mycal/events/evt-1/20260610-1200', '/mycal', saved)).toEqual(saved);
  });

  it('should leave scroll alone when only the query changes on the same view', () => {
    expect(scrollFor('/mycal?categories=abc', '/mycal')).toBe(false);
  });

  it('should leave scroll alone when a locale switch keeps the same view', () => {
    expect(scrollFor('/mycal', '/es/mycal')).toBe(false);
  });
});
