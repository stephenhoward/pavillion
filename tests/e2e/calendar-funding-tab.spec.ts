import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Calendar Settings — Extended Features (Funding)
 *
 * Tests the funding workflow in the Settings tab's Extended Features section:
 *   1. When the widget gate is shut, shows the shared funding upsell.
 *   2. Acting on the upsell opens the FundingSheet overlay.
 *   3. When the gate is open, shows the enabled badge with the disable option.
 *   4. When funding is not enabled on the instance, the gate is open and
 *      nothing is offered for sale.
 *   5. When the calendar is admin-exempt, shows the admin-exempt badge.
 *   6. When the funding state cannot be read, the section is absent entirely —
 *      neither an entitlement nor an upsell.
 *
 * All tests mock the funding API endpoints to control state without
 * requiring real payment provider configuration.
 *
 * The `features` key on the funding-summary mock is load-bearing: the section
 * reads its capability from there, never from `status`. A mock that omits it
 * leaves every gate `unknown` and the section renders nothing at all.
 *
 * Locators here are scoped to `#settings-panel`, because the shared upsell is
 * placed at more than one site and every tab panel is mounted at once — see
 * `settingsPanel()` below.
 */

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

/**
 * Mock funding API endpoints to simulate a specific funding state.
 */
async function mockFundingAPIs(page: import('@playwright/test').Page, options: {
  fundingPlansEnabled: boolean;
  fundingStatus: 'covered' | 'not_covered' | 'grant' | 'admin_exempt';
  /** The widget gate's answer. Independent of `fundingStatus` on purpose —
   *  the two can legitimately disagree, and only this one is an entitlement. */
  widgetEmbedding: boolean;
  /** Fail the funding-summary read, leaving the gate answer unknown. */
  fundingUnreadable?: boolean;
}) {
  // Mock funding plan status (the calendar has no plan)
  await page.route('**/api/funding/v1/status', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'No funding plan found' }),
    });
  });

  // Mock funding plan options
  await page.route('**/api/funding/v1/options', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        enabled: options.fundingPlansEnabled,
        providers: options.fundingPlansEnabled
          ? [{ providerType: 'stripe', displayName: 'Stripe' }]
          : [],
        monthlyPrice: 500000,
        yearlyPrice: 5000000,
        currency: 'USD',
        payWhatYouCan: false,
        payWhatYouCanYearlyDiscount: 0,
      }),
    });
  });

  // Mock the funding summary for any calendar
  await page.route('**/api/funding/v1/calendars/*/funding', async (route) => {
    if (options.fundingUnreadable) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'funding state unreadable' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: options.fundingStatus,
        currentPeriodEnd: null,
        accessExpiresAt: null,
        features: { widget_embedding: options.widgetEmbedding },
      }),
    });
  });
}

/**
 * The settings tab panel — the surface every assertion in this file is about.
 *
 * Calendar management mounts all of its tab panels at once and hides the
 * inactive ones with the `hidden` attribute rather than `v-if`, so the widget
 * tab's markup is in the DOM while the settings tab is showing. The funding
 * upsell is one shared, self-gating card used at both sites, which means a shut
 * widget-embedding gate puts two `.funding-upsell` blocks in the document at the
 * same time. That is the design working: `hidden` keeps the inactive one away
 * from sighted users and assistive tech alike, and exactly one is ever visible.
 *
 * Unscoped `.funding-upsell*` locators are therefore ambiguous by construction,
 * whether or not a given assertion happens to trip strict mode today. Naming the
 * panel keeps each assertion about the surface it means.
 */
function settingsPanel(page: import('@playwright/test').Page) {
  return page.locator('#settings-panel');
}

/**
 * Every upsell a user could actually see, anywhere on the page.
 *
 * The counterpart to scoping: scoping alone would let a real regression — two
 * upsells visible at once — pass unnoticed, so the denied-gate tests assert on
 * this as well.
 */
function visibleUpsells(page: import('@playwright/test').Page) {
  return page.locator('.funding-upsell:visible');
}

/**
 * Navigate to calendar settings tab.
 */
async function navigateToSettingsTab(page: import('@playwright/test').Page, baseURL: string) {
  await page.goto(baseURL + '/calendar/test_calendar/manage');
  await page.waitForSelector('.calendar-management-root__tabs', { timeout: 15000 });

  const settingsTab = page.locator('#settings-tab');
  await settingsTab.click();

  await expect(settingsPanel(page)).toBeVisible({ timeout: 10000 });
}

test.describe('Calendar Settings — Extended Features (Funding)', () => {
  test.beforeAll(async () => {
    env = await startTestServer();
  });

  test.afterAll(async () => {
    await env.cleanup();
  });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
  });

  test('shows the funding upsell when the widget gate is shut', async ({ page }) => {
    await mockFundingAPIs(page, {
      fundingPlansEnabled: true,
      fundingStatus: 'not_covered',
      widgetEmbedding: false,
    });

    await navigateToSettingsTab(page, env.baseURL);

    const upsellAction = settingsPanel(page).locator('.funding-upsell__action');
    await expect(upsellAction).toBeVisible({ timeout: 10000 });

    // The widget tab's copy of the card is mounted and denied too, but hidden
    // with its panel. One offer is on screen, and it is this one.
    await expect(visibleUpsells(page)).toHaveCount(1);
    await expect(settingsPanel(page).locator('.funding-upsell:visible')).toHaveCount(1);
  });

  test('acting on the upsell opens the funding sheet', async ({ page }) => {
    await mockFundingAPIs(page, {
      fundingPlansEnabled: true,
      fundingStatus: 'not_covered',
      widgetEmbedding: false,
    });

    await navigateToSettingsTab(page, env.baseURL);

    const upsellAction = settingsPanel(page).locator('.funding-upsell__action');
    await expect(upsellAction).toBeVisible({ timeout: 10000 });
    await expect(visibleUpsells(page)).toHaveCount(1);
    await upsellAction.click();

    // FundingSheet dialog should appear (Sheet component uses .sheet-dialog).
    // The card renders its sheet in place, so the settings tab's card is the one
    // that must have opened it.
    const fundingSheet = settingsPanel(page).locator('.sheet-dialog');
    await expect(fundingSheet).toBeVisible({ timeout: 10000 });
  });

  test('shows enabled badge when calendar is covered', async ({ page }) => {
    await mockFundingAPIs(page, {
      fundingPlansEnabled: true,
      fundingStatus: 'covered',
      widgetEmbedding: true,
    });

    await navigateToSettingsTab(page, env.baseURL);

    // Should show enabled badge
    const enabledBadge = settingsPanel(page).locator('.setting-badge--enabled');
    await expect(enabledBadge).toBeVisible({ timeout: 10000 });

    // Should show disable button — a plan is the one source with something to cancel
    const disableButton = settingsPanel(page).locator('.setting-disable-btn');
    await expect(disableButton).toBeVisible();

    // An open gate sells nothing, on this tab or any other.
    await expect(page.locator('.funding-upsell')).toHaveCount(0);
  });

  test('sells nothing when funding is not enabled on the instance', async ({ page }) => {
    // Instance-autonomy invariant: a non-charging instance leaves every gate
    // open, so the section reports the features as available and offers no
    // upsell. No separate "funding disabled" flag is consulted.
    await mockFundingAPIs(page, {
      fundingPlansEnabled: false,
      fundingStatus: 'not_covered',
      widgetEmbedding: true,
    });

    await navigateToSettingsTab(page, env.baseURL);

    const enabledBadge = settingsPanel(page).locator('.setting-badge--enabled');
    await expect(enabledBadge).toBeVisible({ timeout: 10000 });

    // Deliberately page-wide: the claim is that nothing is offered for sale
    // anywhere, including the widget tab mounted alongside this one.
    await expect(page.locator('.funding-upsell')).toHaveCount(0);
  });

  test('shows admin-exempt badge for admin-exempt calendars', async ({ page }) => {
    await mockFundingAPIs(page, {
      fundingPlansEnabled: true,
      fundingStatus: 'admin_exempt',
      widgetEmbedding: true,
    });

    await navigateToSettingsTab(page, env.baseURL);

    // Should show enabled badge (admin-exempt uses same badge style)
    const enabledBadge = settingsPanel(page).locator('.setting-badge--enabled');
    await expect(enabledBadge).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.funding-upsell')).toHaveCount(0);
  });

  test('shows neither entitlement nor upsell when the funding state is unreadable', async ({ page }) => {
    await mockFundingAPIs(page, {
      fundingPlansEnabled: true,
      fundingStatus: 'not_covered',
      widgetEmbedding: false,
      fundingUnreadable: true,
    });

    await navigateToSettingsTab(page, env.baseURL);

    const settingsContent = settingsPanel(page).locator('.settings-content');
    await expect(settingsContent).toBeVisible({ timeout: 10000 });

    // Page-wide again: an unreadable funding state must not produce an upsell on
    // any surface, and the widget tab reads the same gate.
    await expect(page.locator('.funding-upsell')).toHaveCount(0);
    await expect(settingsPanel(page).locator('.setting-badge--enabled')).toHaveCount(0);
  });
});
