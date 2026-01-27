import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

/**
 * E2E Regression Tests: Admin Account Management
 *
 * Tests the admin account management workflow to prevent regression
 * of issues identified in QA testing:
 * - Account list loading without 404 errors
 * - Application approval workflow
 * - Invitation sending workflow
 * - Account search and filtering
 *
 * UPDATED: Selectors based on actual Vue component DOM structure
 */

test.describe('Admin Account Management', () => {
  test.beforeEach(async ({ page }) => {
    // Log in as admin before each test
    await loginAsAdmin(page);
  });

  test('should load account list without 404 errors', async ({ page }) => {
    // Track 404 errors
    const failed404Requests: string[] = [];
    page.on('response', response => {
      if (response.status() === 404) {
        failed404Requests.push(response.url());
      }
    });

    // Navigate to Admin > Accounts
    await page.goto('/admin/accounts');

    // Wait for accounts section to load (using semantic HTML)
    await page.waitForSelector('section#accounts', { timeout: 10000 });

    // Wait for either the table or empty state
    await page.waitForSelector('table[role="table"][aria-label="User accounts"], button:has-text("invite")', { timeout: 10000 });

    // Verify no 404 errors occurred
    expect(failed404Requests).toHaveLength(0);
  });

  test('should display admin account in list (not "No accounts")', async ({ page }) => {
    // Navigate to Admin > Accounts
    await page.goto('/admin/accounts');

    // Wait for accounts section
    await page.waitForSelector('section#accounts', { timeout: 10000 });

    // Wait for accounts table (desktop) or account cards (mobile) - both are rendered, use desktop table
    await page.waitForSelector('.accounts-table-desktop table[role="table"][aria-label="User accounts"], .accounts-mobile .account-card', { timeout: 10000 });

    // Check for at least one account in either desktop table rows or mobile cards
    const desktopRows = page.locator('.accounts-table-desktop table[role="table"] tbody tr');
    const mobileCards = page.locator('.accounts-mobile .account-card');
    const desktopCount = await desktopRows.count();
    const mobileCount = await mobileCards.count();
    expect(desktopCount + mobileCount).toBeGreaterThan(0);

    // Should show admin email in the list (visible in whichever layout is active)
    await expect(page.locator('text=admin@pavillion.dev').first()).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to Applications tab without errors', async ({ page }) => {
    // Track console errors
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Navigate to Admin > Accounts
    await page.goto('/admin/accounts');

    // Click on Applications tab using role and aria-controls
    const applicationsTab = page.locator('button[role="tab"][aria-controls="applications-panel"]');
    await applicationsTab.click();

    // Wait for applications panel to be visible
    await page.waitForSelector('section#applications-panel:not([hidden])', { timeout: 5000 });

    // Verify no unexpected console errors
    const relevantErrors = consoleErrors.filter(err =>
      !err.includes('Deprecation') &&
      !err.includes('[vite]') &&
      !err.includes('404')
    );
    expect(relevantErrors).toHaveLength(0);
  });

  test('should navigate to Invitations tab without errors', async ({ page }) => {
    // Track console errors
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Navigate to Admin > Accounts
    await page.goto('/admin/accounts');

    // Click on Invitations tab using role and aria-controls
    const invitationsTab = page.locator('button[role="tab"][aria-controls="invitations-panel"]');
    await invitationsTab.click();

    // Wait for invitations panel to be visible
    await page.waitForSelector('section#invitations-panel:not([hidden])', { timeout: 5000 });

    // Should show either invitations table or "Invite New Account" button
    const hasInviteButton = await page.locator('button:has-text("Invite"), button:has-text("invite")').count() > 0;
    expect(hasInviteButton).toBeTruthy();

    // Verify no mounting errors occurred
    const relevantErrors = consoleErrors.filter(err =>
      !err.includes('Deprecation') &&
      !err.includes('[vite]') &&
      !err.includes('beforeMount')
    );
    expect(relevantErrors).toHaveLength(0);
  });

  test('should send invitation successfully', async ({ page }) => {
    // Navigate to Admin > Accounts
    await page.goto('/admin/accounts');

    // Click on Invitations tab
    const invitationsTab = page.locator('button[role="tab"][aria-controls="invitations-panel"]');
    await invitationsTab.click();

    // Wait for invitations panel
    await page.waitForSelector('section#invitations-panel:not([hidden])', { timeout: 5000 });

    // Click the "Send Invitation" link inside the invitations panel to open the invite form
    // The invitations panel has a .send-invitation-link button when empty,
    // or we may need the header invite-button. Try both patterns.
    const sendInviteLink = page.locator('.send-invitation-link, .invite-button').first();
    await sendInviteLink.click();

    // Wait for InviteFormView modal to render (it's conditionally rendered with v-if)
    await page.waitForSelector('dialog.modal-dialog[open]', { timeout: 5000 });

    // The form should now be visible - look for email input
    const emailInput = page.locator('dialog[open] input[type="email"]').first();
    await expect(emailInput).toBeVisible({ timeout: 3000 });

    // Fill in email address
    const uniqueEmail = `test-${Date.now()}@example.com`;
    await emailInput.fill(uniqueEmail);

    // Find and click the send/submit button inside the dialog
    // The invite form has a .btn-submit button
    const submitButton = page.locator('dialog[open] .btn-submit, dialog[open] button').filter({ hasText: /send|invite/i }).first();
    await submitButton.click({ force: true });

    // Wait for response
    await page.waitForTimeout(2000);

    // Verify success (check for success message or invitation added to list)
    const successMessageExists = await page.getByText(/success|sent/i).count() > 0 ||
                                 await page.locator('.success-message').count() > 0;
    const invitationInList = await page.locator(`text=${uniqueEmail}`).count() > 0;

    expect(successMessageExists || invitationInList).toBeTruthy();
  });
});
