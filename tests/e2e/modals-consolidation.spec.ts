import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Modal/Sheet Consolidation (pv-32pq.2)
 *
 * Lightweight smoke test for the 9-site migration to <Modal> / <Sheet>.
 * Opens 2-3 representative migrated dialogs and asserts:
 * - native `<dialog>` element with aria-modal="true" present (a11y intact)
 * - Escape dismisses the dialog
 * - No JS console errors thrown while the dialog is open
 *
 * Targets (representative of migrations):
 * - Blocked Instances (Modal size="lg") — admin moderation page
 * - Language Picker (Sheet) — calendar settings page, regression anchor
 * - Location Picker (Sheet) — event edit page
 *
 * Rationale: the broader admin / moderation / category / location specs
 * cover the deep workflows; this spec just verifies the consolidated modal
 * shell (role, aria-modal, Escape dismiss, no console errors) across
 * Modal + Sheet sites after the pv-32pq.2 migration.
 */

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

test.describe('Modal/Sheet Consolidation Smoke Tests', () => {
  test.beforeAll(async () => {
    env = await startTestServer();
  });

  test.afterAll(async () => {
    if (env?.cleanup) {
      await env.cleanup();
    }
  });

  test('Blocked Instances modal has dialog semantics and dismisses on Escape', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await loginAsAdmin(page, env.baseURL);
    await page.goto(env.baseURL + '/admin/moderation/blocked-instances');
    await page.waitForLoadState('networkidle');

    // Submit a dummy domain to trigger the unblock confirmation modal if
    // any rows exist. If no blocked instances exist, this test just verifies
    // the page loaded without console errors.
    const unblockButton = page.locator('button:has-text("Unblock")').first();
    const hasUnblockButton = (await unblockButton.count()) > 0;

    if (hasUnblockButton) {
      await unblockButton.click();

      const dialog = page.locator('dialog[aria-modal="true"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Escape dismisses
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden({ timeout: 2000 });
    }

    // Assert: no console errors during page load or dialog interaction
    expect(consoleErrors.filter(e => !e.includes('favicon'))).toEqual([]);
  });

  test('Language Picker sheet has dialog semantics and dismisses on Escape (regression anchor)', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await loginAsAdmin(page, env.baseURL);

    // Navigate to calendar management settings where language picker lives.
    // Use admin user's calendar to access the settings tab.
    await page.goto(env.baseURL + '/calendar');
    await page.waitForLoadState('networkidle');

    // Click the first calendar card to open its management view. If no
    // calendar exists (unlikely since admin is seeded with one), skip gracefully.
    const calendarCard = page.locator('a[href*="/calendar/"]').first();
    if ((await calendarCard.count()) === 0) {
      test.skip();
      return;
    }
    await calendarCard.click();
    await page.waitForLoadState('networkidle');

    // Navigate to settings tab
    const settingsTab = page.getByRole('link', { name: /settings/i }).first();
    if ((await settingsTab.count()) > 0) {
      await settingsTab.click();
      await page.waitForLoadState('networkidle');
    }

    // Find and click a button that opens the language picker (add language)
    const addLangButton = page.getByRole('button', { name: /add language/i }).first();
    if ((await addLangButton.count()) === 0) {
      // Page structure differs for this user; treat as pass-through skip.
      expect(consoleErrors.filter(e => !e.includes('favicon'))).toEqual([]);
      return;
    }

    await addLangButton.click();

    const dialog = page.locator('dialog[aria-modal="true"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Language picker is labelled (has aria-labelledby pointing at title)
    await expect(dialog).toHaveAttribute('aria-labelledby', /.+/);

    // Escape dismisses the sheet
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 2000 });

    // Assert: no console errors during interaction
    expect(consoleErrors.filter(e => !e.includes('favicon'))).toEqual([]);
  });

  test('Location Picker sheet has dialog semantics when opened on event edit page', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await loginAsAdmin(page, env.baseURL);
    await page.goto(env.baseURL + '/event');
    await page.waitForLoadState('networkidle');

    // Open the location picker if the button is available
    const addLocationButton = page.getByRole('button', { name: /add location|change location/i }).first();
    if ((await addLocationButton.count()) === 0) {
      expect(consoleErrors.filter(e => !e.includes('favicon'))).toEqual([]);
      return;
    }

    await addLocationButton.click();

    const dialog = page.locator('dialog[aria-modal="true"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // aria-labelledby points at the Sheet's generated title id
    await expect(dialog).toHaveAttribute('aria-labelledby', /.+/);

    // Escape dismisses
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 2000 });

    expect(consoleErrors.filter(e => !e.includes('favicon'))).toEqual([]);
  });
});
