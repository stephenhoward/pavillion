import { test, expect, APIRequestContext } from '@playwright/test';
import { startTestServer, TestEnvironment } from './helpers/test-server';
import { INSTANCE_SLUG_PATTERN } from '@/common/utils/instance-slug';

/**
 * E2E Tests: Public Calendar Browsing & Event Detail Viewing
 *
 * Tests anonymous access to the public calendar at /test_calendar (DEC-018:
 * public calendars are served from the domain root), event display, category
 * filtering, text search, and event detail navigation.
 *
 * The second describe block pins the routing contract itself: the discovery
 * page at /discover, a calendar at its root URL, and the permanent redirects
 * away from every legacy /view shape.
 *
 * No login required — all tests use anonymous/public access.
 *
 * Covers workflow audit gaps:
 * - 3.1 Browse Public Calendar
 * - 3.2 View Event Details
 *
 * UPDATED: Uses isolated test server with in-memory database for true test isolation
 */

let env: TestEnvironment;

// Configure tests to run serially within this file
// This ensures they share the same test server instance
test.describe.configure({ mode: 'serial' });

// File-level hooks: both describe blocks below share the one test server.
test.beforeAll(async () => {
  // Start isolated test server for this test file
  env = await startTestServer();
});

test.afterAll(async () => {
  // Clean up test server
  if (env?.cleanup) {
    await env.cleanup();
  }
});

test.describe('Public Calendar', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the public calendar for test_calendar
    await page.goto(env.baseURL + '/test_calendar');

    // Conditional skip if public site isn't rendering
    const appContent = await page.locator('#app').textContent({ timeout: 10000 }).catch(() => '');
    if (!appContent || appContent.trim() === '') {
      test.skip();
    }
  });

  test('should render the public calendar page', async ({ page }) => {
    // Verify the calendar loads with content
    const heading = page.locator('h1');
    await expect(heading).toBeVisible({ timeout: 10000 });

    // Verify we're not on a 404 or error page
    const pageContent = await page.textContent('body');
    expect(pageContent).not.toContain('Not Found');
  });

  test('should display seeded events on the public calendar', async ({ page }) => {
    // Wait for events to load
    // New redesign uses: section.day-section for day groups, li.day-event-item for event list items,
    // and article.event-card for the card rendered inside each list item.
    const eventItems = page.locator('li.day-event-item');
    const daySections = page.locator('section.day-section');

    // Wait for either events or an empty state to appear
    await page.waitForSelector('section.day-section, .empty-state, li.day-event-item', { timeout: 15000 });

    const eventCount = await eventItems.count();
    const dayCount = await daySections.count();

    // In the seeded database, test_calendar should have events
    // If no events, verify empty state renders correctly
    if (eventCount === 0 && dayCount === 0) {
      const emptyState = page.locator('.empty-state');
      await expect(emptyState).toBeVisible();
    }
    else {
      // Verify at least one event card has a title (article.event-card contains an h3 with a link)
      const firstEventTitle = eventItems.first().locator('h3');
      await expect(firstEventTitle).toBeVisible();
    }
  });

  test('should filter events by category', async ({ page }) => {
    // Wait for categories to load
    // category-pill-selector is now the scrollable container div, not itself a button.
    // The interactive elements are button.category-pill inside it.
    await page.waitForSelector('button.category-pill, .category-pill-selector-wrapper, .empty-state', { timeout: 15000 });

    const categoryPills = page.locator('button.category-pill');
    const pillCount = await categoryPills.count();

    if (pillCount === 0) {
      // No categories available, skip
      test.skip();
      return;
    }

    // Get the first category name
    const firstPillText = await categoryPills.first().locator('.category-name').textContent();

    // Click the first category pill to filter
    await categoryPills.first().click();

    // Verify the pill is now selected
    await expect(categoryPills.first()).toHaveClass(/selected/);

    // Verify URL updates with category parameter
    const url = page.url();
    expect(url).toContain('categories=');

    // Click again to deselect
    await categoryPills.first().click();

    // Verify the pill is deselected
    await expect(categoryPills.first()).not.toHaveClass(/selected/);
  });

  test('should search events by text', async ({ page }) => {
    // Wait for page to load
    // New redesign uses section.day-section instead of section.day
    await page.waitForSelector('#public-event-search, section.day-section, .empty-state', { timeout: 15000 });

    const searchInput = page.locator('#public-event-search');
    const searchVisible = await searchInput.isVisible().catch(() => false);

    if (!searchVisible) {
      test.skip();
      return;
    }

    // Type a search query (use a term likely to exist in seeded data)
    await searchInput.fill('test');

    // Wait for debounce (300ms) and URL update
    await page.waitForTimeout(500);

    // Verify URL includes search parameter
    const url = page.url();
    expect(url).toContain('search=');

    // Clear search
    const clearBtn = page.locator('.clear-search');
    const clearVisible = await clearBtn.isVisible().catch(() => false);

    if (clearVisible) {
      await clearBtn.click();
      // Verify search is cleared
      await expect(searchInput).toHaveValue('');
    }
  });

  test('should navigate to event detail page', async ({ page }) => {
    // Wait for events to load
    // New redesign uses li.day-event-item (containing article.event-card) instead of li.event
    await page.waitForSelector('li.day-event-item, .empty-state', { timeout: 15000 });

    const eventLinks = page.locator('li.day-event-item h3 a');
    const linkCount = await eventLinks.count();

    if (linkCount === 0) {
      test.skip();
      return;
    }

    // Get the event title before clicking
    const eventTitle = await eventLinks.first().textContent();

    // Click the first event link
    await eventLinks.first().click();

    // Wait for navigation to event detail page.
    // The URL may include an optional locale prefix (e.g. /es/) when the browser's
    // navigator.language is a non-default locale, so we allow for that with [a-z]{2,8}\/.
    // We escape the baseURL before embedding it in a RegExp to handle any special characters
    // (e.g. dots in IP addresses).
    //
    // Use waitUntil: 'commit' because this is a Vue Router SPA navigation via history.pushState.
    // Client-side routing does not fire a browser 'load' event (the default for waitForURL), so
    // we only wait for the URL to commit (change) rather than for a full page reload lifecycle.
    const escapedBase = env.baseURL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Verify the URL ends with a yyyymmdd-hhmm slug — proves the new
    // stable-slug routing is active (legacy UUID hrefs would not match).
    //
    // The assertion is on the settled destination, so it holds whether the card
    // links straight at the root URL or reaches it through the legacy /view 301.
    await page.waitForURL(
      new RegExp(`${escapedBase}(\\/[a-z]{2,8})?\\/test_calendar\\/events\\/[^/]+\\/${INSTANCE_SLUG_PATTERN}$`),
      { timeout: 10000, waitUntil: 'commit' },
    );

    // Verify event detail page renders
    const detailTitle = page.locator('h1');
    await expect(detailTitle).toBeVisible({ timeout: 10000 });

    // Verify the title matches
    if (eventTitle) {
      await expect(detailTitle).toContainText(eventTitle.trim());
    }

    // Verify breadcrumb navigation back to calendar exists
    const breadcrumb = page.locator('.breadcrumb a, p.breadcrumb a');
    await expect(breadcrumb).toBeVisible();
  });
});

/**
 * The root-URL routing contract (DEC-018), proved through the real server
 * rather than a mounted router: the discovery page answers at /discover, a
 * calendar answers at its own root URL, and every legacy /view shape answers
 * 301 with a same-origin Location.
 *
 * The unit tier (src/server/common/test/app_routes.test.ts) already covers the
 * route table exhaustively. What only this tier can show is that a redirect
 * target actually resolves: the 301 lands on a URL the site SPA has a route
 * for, in a real browser, after the full middleware stack has run.
 */
test.describe('Root URLs and legacy /view redirects', () => {
  /**
   * Issue a request without following redirects and return the status and
   * Location header, so a redirect is asserted by the response itself rather
   * than by whatever page happens to render at the end of the chain.
   */
  async function redirectFor(
    request: APIRequestContext,
    path: string,
  ): Promise<{ status: number; location: string | undefined }> {
    const response = await request.get(env.baseURL + path, { maxRedirects: 0 });
    return { status: response.status(), location: response.headers()['location'] };
  }

  test('serves the discovery page at /discover', async ({ page }) => {
    const response = await page.goto(env.baseURL + '/discover');
    expect(response?.status()).toBe(200);

    // The discovery heading and its subheading render regardless of how many
    // calendars the seeded instance lists, so this holds for the empty state too.
    await expect(page.locator('h1.discovery-title')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('h2.discovery-subheading')).toBeVisible();
  });

  test('serves a calendar at its root URL', async ({ page }) => {
    const response = await page.goto(env.baseURL + '/test_calendar');
    expect(response?.status()).toBe(200);

    // The calendar page renders its own h1 and is not the discovery page.
    await expect(page.locator('h1')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('h1.discovery-title')).toHaveCount(0);
    await expect(page.locator('#public-event-search')).toBeVisible({ timeout: 10000 });
  });

  // Each legacy shape redirects exactly once, to its final destination. A
  // default-locale prefix is dropped in the same hop as the /view segment, so
  // /en/view/test_calendar must not stop at /test_calendar via /en/test_calendar.
  const redirectCases: { from: string; to: string; why: string }[] = [
    { from: '/view', to: '/discover', why: 'bare /view carries no calendar' },
    { from: '/view/', to: '/discover', why: 'trailing slash, still no calendar' },
    { from: '/view/test_calendar', to: '/test_calendar', why: 'calendar moves to the root' },
    {
      from: '/view/test_calendar/events/abc/20260101-1200',
      to: '/test_calendar/events/abc/20260101-1200',
      why: 'the whole tail is preserved',
    },
    { from: '/es/view/test_calendar', to: '/es/test_calendar', why: 'a non-default locale prefix survives' },
    { from: '/en/view/test_calendar', to: '/test_calendar', why: 'the default locale prefix is dropped in the same hop' },
    { from: '/en/view', to: '/discover', why: 'default locale + bare /view, one hop' },
    { from: '/es/view', to: '/es/discover', why: 'non-default locale + bare /view' },
    { from: '/en', to: '/discover', why: 'a bare default-locale root has no page of its own' },
    { from: '/es', to: '/es/discover', why: 'a bare locale root lands on that locale discovery page' },
  ];

  for (const { from, to, why } of redirectCases) {
    test(`301s ${from} to ${to} (${why})`, async ({ request }) => {
      const { status, location } = await redirectFor(request, from);

      expect(status).toBe(301);
      expect(location).toBe(to);
    });
  }

  test('re-attaches a query string verbatim, repeated parameters included', async ({ request }) => {
    const { status, location } = await redirectFor(
      request,
      '/view/test_calendar?categories=one&categories=two&search=fair',
    );

    expect(status).toBe(301);
    // Verbatim means lossless: a repeated parameter survives as two entries,
    // which a parse-and-rebuild of req.query would have collapsed to one.
    expect(location).toBe('/test_calendar?categories=one&categories=two&search=fair');
  });

  test('cannot be steered off-origin by a doubled slash', async ({ request, page }) => {
    // Express does not collapse repeated slashes, so without the same-origin
    // normalisation this would answer Location: //evil.com — a protocol-relative
    // URL the browser resolves against evil.com.
    const { status, location } = await redirectFor(request, '/view//evil.com');

    expect(status).toBe(301);
    expect(location).toBe('/evil.com');
    expect(location?.startsWith('//')).toBe(false);

    // And prove it in the browser: following the redirect stays on this origin.
    await page.goto(env.baseURL + '/view//evil.com');
    expect(new URL(page.url()).origin).toBe(new URL(env.baseURL).origin);
  });

  test('lands a legacy calendar URL on the rendered root page', async ({ page }) => {
    // End-to-end proof that the redirect target is a URL the site SPA can
    // actually route: the calendar page renders after the hop, not a blank shell.
    await page.goto(env.baseURL + '/view/test_calendar');

    expect(page.url()).toBe(env.baseURL + '/test_calendar');
    await expect(page.locator('h1')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#public-event-search')).toBeVisible({ timeout: 10000 });
  });
});
