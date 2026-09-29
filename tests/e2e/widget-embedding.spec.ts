import { test, expect, type Page } from '@playwright/test';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Cross-Origin Widget Embedding
 *
 * Validates that the Pavillion calendar widget works correctly when embedded
 * in an external website from a different origin. Tests cover the 4 critical
 * bugs fixed in pv-4d5:
 *   1. Widget JS endpoint returns correct Content-Type (JavaScript, not HTML)
 *   2. CORS/Cross-Origin-Resource-Policy headers allow cross-origin script loading
 *   3. Widget SDK origin detection works correctly with async script loading
 *   4. Widget page CSP frame-ancestors allows iframe embedding
 *
 * Architecture:
 * - Embedding page served from localhost:8080 (static file server)
 * - Widget SDK and widget page served from localhost:3100-3200 (test server)
 * - Different ports = different origins = true cross-origin testing
 *
 * The embedding page (tests/e2e/test-widget-embedding.html) accepts
 * ?serverUrl= and ?calendar= query parameters. Display config (view,
 * accentColor, colorMode) is sourced from server-side widget config; see
 * widget-config-roundtrip.spec.ts for end-to-end view-mode coverage.
 */

let env: TestEnvironment;

function embeddingUrl(): string {
  return `http://localhost:8080/test-widget-embedding.html?serverUrl=${encodeURIComponent(env.baseURL)}&calendar=test_calendar`;
}

const WIDGET_FRAME = 'iframe[src*="/widget/"]';

/** The embedded widget iframe's height on the host page, as the SDK last set it. */
function frameHeight(page: Page): Promise<number> {
  return page.locator(WIDGET_FRAME).evaluate((el) => el.getBoundingClientRect().height);
}

/**
 * The SDK sets `scrolling="no"`, so anything past the frame's bottom edge is
 * cut off: the widget document must fit the frame exactly, footer included.
 */
async function expectDocumentFitsFrame(page: Page): Promise<void> {
  const html = page.frameLocator(WIDGET_FRAME).locator('html');
  await expect.poll(async () => {
    const { documentHeight, viewportHeight, footerBottom } = await html.evaluate((el) => ({
      documentHeight: el.scrollHeight,
      viewportHeight: el.clientHeight,
      footerBottom: document.querySelector('.widget-footer')!.getBoundingClientRect().bottom,
    }));
    return documentHeight - viewportHeight <= 1 && Math.abs(footerBottom - viewportHeight) <= 1;
  }, { timeout: 10000 }).toBe(true);
}

// Configure tests to run serially since they share a test server
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  env = await startTestServer();
});

test.afterAll(async () => {
  await env.cleanup();
});

test.describe('Widget Embedding', () => {
  test('widget loads and displays events from external origin', async ({ page }) => {
    // Track console errors to catch CSP/CORS violations
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Filter out known harmless errors (favicon 404, etc.)
        if (!text.includes('favicon') && !text.includes('404')) {
          consoleErrors.push(text);
        }
      }
    });

    // Step 1: Navigate to embedding page on port 8080 (different origin from test server)
    // The ?serverUrl= parameter tells the embedding page where to load the widget SDK from
    await page.goto(embeddingUrl());

    // Step 2: Wait for widget SDK to load and become a function
    // This validates bug #1 (Content-Type) and bug #2 (CORS/CORP headers):
    // - If the JS endpoint returns HTML, the script will fail to parse and window.Pavillion stays a queue
    // - If CORS/CORP headers are wrong, the script will be blocked before execution
    await page.waitForFunction(
      () => typeof (window as any).Pavillion === 'function',
      { timeout: 15000 },
    );

    // Step 3: Wait for iframe to be created in the DOM
    // This validates bug #3 (SDK origin detection):
    // - If origin detection fails, the SDK won't call createIframe() correctly
    // - The iframe src should point to the test server (not localhost:8080)
    await page.waitForSelector('iframe[src*="/widget/"]', { timeout: 15000 });

    // Verify the iframe src points to the test server (correct origin detection)
    const iframeSrc = await page.$eval('iframe[src*="/widget/"]', (el) => (el as HTMLIFrameElement).src);
    expect(iframeSrc).toContain(env.baseURL);
    expect(iframeSrc).toContain('/widget/test_calendar');

    // Step 4: Access iframe content using frameLocator
    // This validates bug #4 (CSP frame-ancestors):
    // - If frame-ancestors blocks the embed, the iframe body will not be accessible
    const iframe = page.frameLocator('iframe[src*="/widget/"]');

    // Wait for the iframe body to be accessible and visible
    await expect(iframe.locator('body')).toBeVisible({ timeout: 20000 });

    // Step 5: Verify events display inside the iframe
    // The widget ListView renders events as <li class="day-event-item"> wrappers
    // around the shared site EventCard (an <article class="event-card">).
    // The seeded test_calendar has multiple events - wait for at least one to appear
    await expect(iframe.locator('article.event-card').first()).toBeVisible({ timeout: 15000 });

    // Confirm multiple events exist in the seeded test data
    const eventCount = await iframe.locator('article.event-card').count();
    expect(eventCount).toBeGreaterThanOrEqual(1);

    // Smoke-level parity check: widget list view now renders the full site
    // EventCard, so seeded events should produce at least one location pill
    // or category badge in the iframe DOM.
    await expect(
      iframe.locator('.event-location, .category-badge').first(),
    ).toBeVisible({ timeout: 15000 });

    // Step 6: Verify no CSP or CORS errors occurred during the entire test
    // This provides a safety net to catch any security violations that slipped through
    const criticalErrors = consoleErrors.filter(err => {
      const lower = err.toLowerCase();
      return lower.includes('csp') ||
        lower.includes('cors') ||
        lower.includes('cross-origin') ||
        lower.includes('content-security-policy') ||
        lower.includes('refused to load') ||
        lower.includes('blocked by') ||
        lower.includes('cross-origin-resource-policy');
    });

    expect(
      criticalErrors,
      `Expected no CSP/CORS violations but got: ${criticalErrors.join('; ')}`,
    ).toHaveLength(0);
  });

  test('widget iframe src uses correct server origin', async ({ page }) => {
    await page.goto(embeddingUrl());

    // Wait for SDK to initialize and create the iframe
    await page.waitForFunction(
      () => typeof (window as any).Pavillion === 'function',
      { timeout: 15000 },
    );
    await page.waitForSelector('iframe[src*="/widget/"]', { timeout: 15000 });

    // Verify the iframe origin matches the test server, not the embedding page origin
    const iframeOrigin = await page.$eval('iframe[src*="/widget/"]', (el) => {
      const src = (el as HTMLIFrameElement).src;
      try {
        return new URL(src).origin;
      }
      catch {
        return '';
      }
    });

    // The iframe should point to the test server (dynamic port), not port 8080
    expect(iframeOrigin).toBe(env.baseURL);
    expect(iframeOrigin).not.toBe('http://localhost:8080');
  });

  test('widget status indicator shows successful load', async ({ page }) => {
    await page.goto(embeddingUrl());

    // Wait for the SDK script to load (the embedding page updates #status on script load)
    await page.waitForFunction(
      () => typeof (window as any).Pavillion === 'function',
      { timeout: 15000 },
    );

    // The test embedding page shows loading status
    // When script loads successfully, it gets class 'ready'
    const statusEl = page.locator('#status');
    await expect(statusEl).toBeVisible();
    await expect(statusEl).toHaveClass(/ready/, { timeout: 15000 });
    await expect(statusEl).not.toHaveClass(/error/);
  });

  test('event detail click-through and back navigation', async ({ page }) => {
    // The widget document fetches the site config exactly once as it boots, so
    // a second request means the click reloaded the iframe document instead of
    // routing inside the widget SPA.
    let siteConfigRequests = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/config/v1/site') {
        siteConfigRequests++;
      }
    });

    await page.goto(embeddingUrl());

    await page.waitForSelector('iframe[src*="/widget/"]', { timeout: 15000 });
    const iframe = page.frameLocator('iframe[src*="/widget/"]');

    // Wait for events to render in list view (EventCard articles)
    await expect(iframe.locator('article.event-card').first()).toBeVisible({ timeout: 15000 });
    expect(siteConfigRequests).toBe(1);

    // The color mode is `data-theme` on the widget document's <html> (absent
    // for auto); capture it on the list so the detail view can be held to the
    // same one.
    const themeAttribute = async () => iframe.locator('html').getAttribute('data-theme');
    const listTheme = await themeAttribute();
    expect([null, 'light', 'dark']).toContain(listTheme);

    // Click the first event title link to navigate to the detail overlay.
    // EventCard intercepts the plain click and pushes the href through the
    // widget router, so the iframe document is never reloaded.
    await iframe.locator('article.event-card .event-title-link').first().click();

    // Verify event detail overlay appears with event name
    await expect(iframe.locator('.event-detail-overlay')).toBeVisible({ timeout: 10000 });
    await expect(iframe.locator('.event-detail-overlay h1')).toBeVisible();

    expect(siteConfigRequests).toBe(1);
    expect(await themeAttribute()).toBe(listTheme);

    // Click back button to return to list view
    await iframe.locator('.back-link').first().click();

    // Verify list view is restored
    await expect(iframe.locator('article.event-card').first()).toBeVisible({ timeout: 10000 });
  });

  test('custom date range survives the event-detail round trip', async ({ page }) => {
    // Loaded at the widget URL directly, the way an iframe reload or a deep
    // link arrives, with a range the default window would not produce.
    const isoDate = (date: Date) => date.toISOString().slice(0, 10);
    const startDate = isoDate(new Date());
    const endDate = isoDate(new Date(Date.now() + 75 * 24 * 60 * 60 * 1000));

    const nextEventsRequest = () => page.waitForRequest(
      (request) => new URL(request.url()).pathname === '/api/public/v1/calendar/test_calendar/events',
    );
    const expectRange = (request: { url(): string }) => {
      const params = new URL(request.url()).searchParams;
      expect(params.get('startDate')).toBe(startDate);
      expect(params.get('endDate')).toBe(endDate);
    };
    const hasListQuery = (url: URL) => url.pathname === '/widget/test_calendar'
      && url.searchParams.get('startDate') === startDate
      && url.searchParams.get('endDate') === endDate
      && url.searchParams.get('lang') === 'en';

    const cards = page.locator('article.event-card');
    const titleLink = page.locator('article.event-card .event-title-link').first();

    // Direct load: the URL range is what gets fetched, and it stays in the URL.
    const initialLoad = nextEventsRequest();
    await page.goto(`${env.baseURL}/widget/test_calendar?startDate=${startDate}&endDate=${endDate}&lang=en`);
    expectRange(await initialLoad);
    await expect(cards.first()).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(hasListQuery);
    const listCount = await cards.count();

    // In-widget Back button.
    await titleLink.click();
    await expect(page.locator('.event-detail-overlay h1')).toBeVisible({ timeout: 10000 });
    const afterBackButton = nextEventsRequest();
    await page.locator('.back-link').first().click();
    expectRange(await afterBackButton);
    await expect(page).toHaveURL(hasListQuery);
    await expect(cards).toHaveCount(listCount, { timeout: 10000 });

    // Browser back.
    await titleLink.click();
    await expect(page.locator('.event-detail-overlay h1')).toBeVisible({ timeout: 10000 });
    const afterHistoryBack = nextEventsRequest();
    await page.goBack();
    expectRange(await afterHistoryBack);
    await expect(page).toHaveURL(hasListQuery);
    await expect(cards).toHaveCount(listCount, { timeout: 10000 });
  });

  test('modifier-click on an event title opens the detail in a new tab', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP target discovery is Chromium-only');

    await page.goto(embeddingUrl());

    await page.waitForSelector('iframe[src*="/widget/"]', { timeout: 15000 });
    const iframe = page.frameLocator('iframe[src*="/widget/"]');
    await expect(iframe.locator('article.event-card').first()).toBeVisible({ timeout: 15000 });

    const titleLink = iframe.locator('article.event-card .event-title-link').first();
    const href = await titleLink.getAttribute('href');
    expect(href).toContain('/widget/test_calendar/events/');

    // EventCard leaves modified clicks to the native anchor, so the browser
    // opens the href in a new tab and the widget stays on its list.
    //
    // The tab is observed through CDP target discovery rather than
    // context.waitForEvent('page'): Chromium reliably opens a modifier-click
    // tab in this context and navigates it to the href, but Playwright
    // intermittently never surfaces that tab as a Page. A tab that lands
    // anywhere other than the detail URL, or never opens, fails the wait.
    const detailUrl = new URL(href!, env.baseURL).href;
    const pageSession = await page.context().newCDPSession(page);
    const browserSession = await page.context().browser()!.newBrowserCDPSession();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const { targetInfo: opener } = await pageSession.send('Target.getTargetInfo');
      const newTabAtDetail = new Promise<string>((resolve) => {
        const onTarget = ({ targetInfo }: { targetInfo: typeof opener }) => {
          if (
            targetInfo.type === 'page'
            && targetInfo.browserContextId === opener.browserContextId
            && targetInfo.targetId !== opener.targetId
            && targetInfo.url === detailUrl
          ) {
            resolve(targetInfo.targetId);
          }
        };
        browserSession.on('Target.targetCreated', onTarget);
        browserSession.on('Target.targetInfoChanged', onTarget);
      });
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`no page target reached ${detailUrl} within 10s`)),
          10000,
        );
      });
      await browserSession.send('Target.setDiscoverTargets', { discover: true });

      await titleLink.click({ modifiers: ['ControlOrMeta'] });

      const newTabId = await Promise.race([newTabAtDetail, timedOut]);
      await browserSession.send('Target.closeTarget', { targetId: newTabId });
    }
    finally {
      clearTimeout(timer);
      await browserSession.detach();
      await pageSession.detach();
    }

    await expect(iframe.locator('.event-detail-overlay')).toHaveCount(0);
    await expect(iframe.locator('article.event-card').first()).toBeVisible();
  });

  test('default server config drives accent color CSS variable', async ({ page }) => {
    // Display config (view, accentColor, colorMode) is now sourced from
    // server-side widget config, not from SDK init args. With no admin
    // override, the widget renders using WIDGET_CONFIG_DEFAULTS — verify the
    // default accent color reaches the iframe DOM as a CSS custom property.
    await page.goto(embeddingUrl());

    await page.waitForSelector('iframe[src*="/widget/"]', { timeout: 15000 });
    const iframe = page.frameLocator('iframe[src*="/widget/"]');
    await expect(iframe.locator('body')).toBeVisible({ timeout: 20000 });

    const accentVars = await iframe.locator('.widget-root').evaluate(
      (el) => ({
        light: el.style.getPropertyValue('--pav-accent-light'),
        dark: el.style.getPropertyValue('--pav-accent-dark'),
      }),
    );
    // Both light/dark accent variables resolve to the default orange on the widget root.
    expect(accentVars.light).toBeTruthy();
    expect(accentVars.dark).toBeTruthy();
  });

  test('postMessage resize events reach the embedding page', async ({ page }) => {
    await page.goto(embeddingUrl());

    await page.waitForSelector('iframe[src*="/widget/"]', { timeout: 15000 });
    const iframe = page.frameLocator('iframe[src*="/widget/"]');

    // Wait for widget to fully load with events
    await expect(iframe.locator('article.event-card').first()).toBeVisible({ timeout: 15000 });

    // Wait for at least one pavillion:resize message to arrive on the embedding page.
    // The widget debounces resize notifications by 100ms, so poll until one appears.
    await page.waitForFunction(
      () => (window as any).__messages.some((m: any) => m.type === 'pavillion:resize'),
      { timeout: 10000 },
    );

    const resizeMessages = await page.evaluate(
      () => (window as any).__messages.filter((m: any) => m.type === 'pavillion:resize'),
    );
    expect(resizeMessages.length).toBeGreaterThanOrEqual(1);
    expect(resizeMessages[0]).toHaveProperty('height');
    expect(typeof resizeMessages[0].height).toBe('number');
  });

  test('iframe height matches the widget document and shrinks with its content', async ({ page }) => {
    await page.goto(embeddingUrl());

    await page.locator(WIDGET_FRAME).waitFor({ timeout: 15000 });
    const iframe = page.frameLocator(WIDGET_FRAME);
    await expect(iframe.locator('article.event-card').first()).toBeVisible({ timeout: 15000 });

    await expectDocumentFitsFrame(page);
    const fullHeight = await frameHeight(page);

    // A search with no matches empties the list; the frame must follow the
    // content down rather than hold its previous height.
    await iframe.locator('#public-event-search').fill('zzqxnomatchzzqx');
    await expect(iframe.locator('.empty-state')).toBeVisible({ timeout: 10000 });
    await expect.poll(() => frameHeight(page), { timeout: 10000 }).toBeLessThan(fullHeight - 100);
    await expectDocumentFitsFrame(page);
  });

  test('frame keeps its height while a routed view loads, list to detail and back', async ({ page }) => {
    await page.goto(embeddingUrl());

    await page.locator(WIDGET_FRAME).waitFor({ timeout: 15000 });
    const iframe = page.frameLocator(WIDGET_FRAME);
    await expect(iframe.locator('article.event-card').first()).toBeVisible({ timeout: 15000 });
    await expectDocumentFitsFrame(page);
    const listHeight = await frameHeight(page);

    // Slow the widget's API well past the resize debounce, so each view sits
    // in its loading state long enough for a collapse to be reported.
    await page.route(`${env.baseURL}/api/**`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });

    // Every height the host page gives the frame, in order.
    await page.evaluate((selector) => {
      const frame = document.querySelector(selector) as HTMLIFrameElement;
      const heights: number[] = [];
      (window as any).__frameHeights = heights;
      new ResizeObserver(() => heights.push(frame.getBoundingClientRect().height)).observe(frame);
    }, WIDGET_FRAME);
    const takeHeights = () => page.evaluate(() => (window as any).__frameHeights.splice(0) as number[]);

    await iframe.locator('article.event-card .event-title-link').first().click();
    await expect(iframe.locator('.event-detail-overlay h1')).toBeVisible({ timeout: 10000 });
    await expectDocumentFitsFrame(page);
    const detailHeight = await frameHeight(page);
    // The detail is shorter than the list, so the hold was released and the
    // frame still shrinks once the view settles.
    expect(detailHeight).toBeLessThan(listHeight);
    // Never below where it started or where it settled: no loading-state dip.
    const toDetail = await takeHeights();
    expect(toDetail.length).toBeGreaterThan(0);
    expect(Math.min(...toDetail)).toBeGreaterThanOrEqual(Math.min(listHeight, detailHeight) - 1);

    await iframe.locator('.back-link').first().click();
    await expect(iframe.locator('article.event-card').first()).toBeVisible({ timeout: 10000 });
    await expectDocumentFitsFrame(page);
    const backHeight = await frameHeight(page);
    const toList = await takeHeights();
    expect(toList.length).toBeGreaterThan(0);
    expect(Math.min(...toList)).toBeGreaterThanOrEqual(Math.min(detailHeight, backHeight) - 1);
  });

  test('custom date popover stays inside a frame shrunk to an empty list', async ({ page }) => {
    await page.goto(embeddingUrl());

    const frameElement = page.locator('iframe[src*="/widget/"]');
    await frameElement.waitFor({ timeout: 15000 });
    const iframe = page.frameLocator('iframe[src*="/widget/"]');
    await expect(iframe.locator('article.event-card').first()).toBeVisible({ timeout: 15000 });
    const fullHeight = await frameElement.evaluate((el) => el.getBoundingClientRect().height);

    // The popover is absolutely positioned, so it adds nothing to the height
    // the widget reports; with the frame at its shortest it must still fit.
    await iframe.locator('#public-event-search').fill('zzqxnomatchzzqx');
    await expect(iframe.locator('.empty-state')).toBeVisible({ timeout: 10000 });
    await expect.poll(
      () => frameElement.evaluate((el) => el.getBoundingClientRect().height),
      { timeout: 10000 },
    ).toBeLessThan(fullHeight - 100);

    await iframe.locator('.date-filter-button').click();
    await iframe.locator('.date-pill.calendar-pill').click();
    await expect(iframe.locator('.date-input')).toHaveCount(2);

    const { popoverBottom, viewportHeight } = await iframe.locator('html').evaluate((html) => ({
      popoverBottom: document.querySelector('.date-dropdown')!.getBoundingClientRect().bottom,
      viewportHeight: html.clientHeight,
    }));
    expect(popoverBottom).toBeLessThanOrEqual(viewportHeight);
  });

  test('widget document never overflows horizontally, list or event detail', async ({ page }) => {
    const widths = [320, 375, 480, 600, 768, 1024, 1128, 1280];
    const expectNoHorizontalOverflow = async (label: string) => {
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await expect.poll(
          () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
          { message: `${label} at ${width}px: scrollWidth exceeds clientWidth by` },
        ).toBeLessThanOrEqual(0);
      }
    };

    // Loaded directly, the page viewport is the widget's viewport, as the
    // iframe's width is for an embed.
    await page.goto(`${env.baseURL}/widget/test_calendar`);
    await expect(page.locator('article.event-card').first()).toBeVisible({ timeout: 15000 });
    await expectNoHorizontalOverflow('list view');

    await page.locator('article.event-card .event-title-link').first().click();
    await expect(page.locator('.event-detail-overlay h1')).toBeVisible({ timeout: 10000 });
    await expectNoHorizontalOverflow('event detail');
  });

  test('custom date inputs fit inside the date popover', async ({ page }) => {
    // A desktop width, and one below the 600px breakpoint where the inputs stack.
    for (const width of [1128, 400]) {
      await test.step(`${width}px`, async () => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`${env.baseURL}/widget/test_calendar`);
        await expect(page.locator('article.event-card').first()).toBeVisible({ timeout: 15000 });

        await page.locator('.date-filter-button').click();
        await expect(page.locator('.date-dropdown')).toBeVisible();
        await page.locator('.date-pill.calendar-pill').click();
        await expect(page.locator('.date-input')).toHaveCount(2);

        const popover = (await page.locator('.date-dropdown').boundingBox())!;
        for (const input of await page.locator('.date-input').all()) {
          const box = (await input.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(popover.x);
          expect(box.x + box.width).toBeLessThanOrEqual(popover.x + popover.width);
        }
      });
    }
  });
});
