import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startTestServer, TestEnvironment } from '../helpers/test-server';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  LOCAL_DOMAIN,
  TESTUSER_CALENDAR_URL_NAME,
  TESTUSER_EMAIL,
  TESTUSER_PASSWORD,
  loginViaUi,
  seedNotificationFixtures,
  type NotificationFixtures,
} from '../helpers/notification-fixtures';

/**
 * Accessibility scans for the restructured inbox row and the reports panel
 * reached by the `?report=` deep link (pv-mvfk.7).
 *
 * The unit-tier a11y assertions target the two violations this epic was
 * opened for — the 4.1.2 nesting of interactive controls inside an
 * interactive row, and a static row label overriding its own content. A scan
 * is the compensating control for the classes those assertions cannot see:
 * list semantics after the restructure, redundant roles, and focus-visible
 * gaps. The project has an accessibility *auditor* but no accessibility
 * advisor, so nothing catches these before code lands.
 *
 * The ruleset is pinned explicitly rather than left at the library default so
 * an `axe-core` minor bump cannot silently widen or narrow the gate.
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * `color-contrast` is excluded from the REPORTS PANEL scan alone, and this is a
 * recorded exception rather than a convenience.
 *
 * The inbox row no longer needs it. `a.actor-link` / `a.object-link` used to
 * render `--pav-color-interactive-primary` (→ `--pav-color-brand-primary`,
 * `#F97316`) on the row's `#fafafa` at **2.69:1** against a 4.5:1 threshold;
 * they now render `--pav-color-interactive-active-text` (→
 * `--pav-color-orange-700`, `#C2410C`) at **4.96:1**, and
 * `--pav-color-orange-300` on the dark surface at **8.99:1**. The inbox scan
 * below therefore runs with `color-contrast` ENABLED and gates it.
 *
 * What remains is the reports panel: the shared `.pill-button--primary`
 * renders white on `#F97316` at **2.8:1**. That button is a design-system
 * component this epic never touched, on a surface this epic only deep-links
 * into — which is what makes the diagnosis unambiguously pre-existing.
 * Repainting it is a design-system change with app-wide blast radius, not a
 * test fix. Tracked, with the remaining components that use the brand token as
 * inline text colour, as pv-jqa4.
 *
 * Every other rule in the pinned set passes on both surfaces, so the scans
 * still gate exactly what they were added to gate. Narrow the exclusion —
 * never widen it — as pv-jqa4 lands.
 */
const KNOWN_DESIGN_TOKEN_VIOLATIONS = ['color-contrast'];

let env: TestEnvironment;
let fixtures: NotificationFixtures;

test.describe.configure({ mode: 'serial' });

test.describe('Inbox accessibility scans', () => {
  test.beforeAll(async () => {
    // Allocate outside the shared 3100-3200 pool. `findAvailablePort` picks a
    // port and only the spawned server binds it, so two spec files whose
    // `beforeAll` runs in the same instant are both handed 3100 — the second
    // server then fails to bind and its fixtures silently drive the first
    // server's database. `inbox-navigation.spec.ts` starts at the same moment
    // as this file and reproduced exactly that, deterministically, at the
    // default two workers.
    env = await startTestServer({
      extraEnv: { LOCAL_DOMAIN },
      portRangeStart: 3201,
      portRangeEnd: 3250,
    });
    fixtures = await seedNotificationFixtures(env.baseURL);
  });

  test.afterAll(async () => {
    if (env?.cleanup) {
      await env.cleanup();
    }
  });

  test('the notifications list has no WCAG violations, with both a linked and an unlinked row present', async ({ page }) => {
    await loginViaUi(page, env.baseURL, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto(env.baseURL + '/inbox');
    await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible({
      timeout: 10000,
    });

    // Both row shapes must be on screen or the scan proves nothing about the
    // restructure: the `Announce` row carries an actor link and an object
    // link, the `Follow` row derives `target: null` and so offers no object
    // link at all.
    const linkedRow = page
      .locator('[data-testid="notification-item"]')
      .filter({ hasText: 'reposted' })
      .first();
    const unlinkedRow = page
      .locator('[data-testid="notification-item"]')
      .filter({ hasText: 'followed your calendar' })
      .first();
    await expect(linkedRow).toBeVisible({ timeout: 10000 });
    await expect(unlinkedRow).toBeVisible({ timeout: 10000 });
    await expect(linkedRow.locator('a.object-link')).toBeVisible();
    await expect(unlinkedRow.locator('a.object-link')).toHaveCount(0);

    const results = await new AxeBuilder({ page })
      .include('ul.notifications-list')
      .withTags(WCAG_TAGS)
      .analyze();

    // Compare ids rather than the raw violation objects: a failing diff of
    // rule ids is readable, a diff of full axe nodes is not.
    expect(results.violations.map(violation => violation.id)).toEqual([]);
  });

  test('the reports tabpanel has no WCAG violations after the deep-link focus move', async ({ page }) => {
    await loginViaUi(page, env.baseURL, TESTUSER_EMAIL, TESTUSER_PASSWORD);

    await page.goto(
      `${env.baseURL}/calendar/${TESTUSER_CALENDAR_URL_NAME}/manage`
      + `?tab=reports&report=${fixtures.ownedReportId}`,
    );

    // Scan only once the deep link has actually resolved: the tab activated,
    // the report detail rendered, and focus landed on the panel. Scanning
    // before that would measure the editors tab.
    await expect(page.locator('.report-detail')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#reports-tab')).toHaveAttribute('aria-selected', 'true');
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id ?? null))
      .toBe('reports-panel');

    const results = await new AxeBuilder({ page })
      .include('#reports-panel')
      .withTags(WCAG_TAGS)
      .disableRules(KNOWN_DESIGN_TOKEN_VIOLATIONS)
      .analyze();

    expect(results.violations.map(violation => violation.id)).toEqual([]);
  });
});
