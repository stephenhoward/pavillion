import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';
import { clearEmails, waitForEmail } from './helpers/emails';
import axios from 'axios';

/**
 * E2E Tests: Calendar Editor Collaboration
 *
 * Tests the complete editor invitation and management lifecycle:
 * - Invite an editor via email from the calendar management UI
 * - Verify invitation email is sent via EmailStore
 * - Accept the invitation using the code from the editor invitation email
 * - Verify the editor appears in the calendar's editor list
 * - Remove the editor and verify removal
 *
 * Uses isolated test server with in-memory database for true test isolation.
 * Tests run serially within this file to share the same test server instance.
 */

let env: TestEnvironment;

const INVITEE_EMAIL = 'new-editor@example.com';
const INVITEE_PASSWORD = 'SecurePass123!';

test.describe.configure({ mode: 'serial' });

test.describe('Calendar Editor Collaboration', () => {
  test.beforeAll(async () => {
    console.log('[Test] Starting test server...');
    try {
      env = await startTestServer();
      console.log(`[Test] Server started successfully at ${env.baseURL}`);
    }
    catch (error) {
      console.error('[Test] Failed to start server:', error);
      throw error;
    }
  });

  test.afterAll(async () => {
    console.log('[Test] Cleaning up test server...');
    if (env?.cleanup) {
      await env.cleanup();
    }
  });

  test.describe('Editor Invitation Flow', () => {
    test.beforeEach(async ({ page }) => {
      await loginAsAdmin(page, env.baseURL);
    });

    test('should invite an editor via email and show pending invitation', async ({ page }) => {
      // Clear any previously stored emails
      await clearEmails(env.baseURL);

      // Navigate to calendar management page - Editors tab is the default
      await page.goto(env.baseURL + '/calendar/test_calendar/manage');
      await page.waitForTimeout(2000);

      // Wait for editors content to load
      await page.waitForTimeout(1000);

      // Click the Add Editor button
      const addEditorButton = page.locator('button.btn--cta').filter({ hasText: /Add Editor/i });
      await expect(addEditorButton).toBeVisible({ timeout: 5000 });
      await addEditorButton.click();

      // Wait for the modal to appear
      const modal = page.locator('dialog.modal[open]');
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Fill in the email address
      const emailInput = modal.locator('input#email');
      await expect(emailInput).toBeVisible({ timeout: 3000 });
      await emailInput.fill(INVITEE_EMAIL);

      // Click the Add Editor button in the modal
      const submitButton = modal.locator('button.pill-button--primary').filter({ hasText: /Add Editor/i });
      await submitButton.click();

      // Wait for the modal to close and success message to appear
      await page.waitForTimeout(2000);

      // Verify success message appears (invitation pending)
      const successAlert = page.locator('.alert--success');
      await expect(successAlert).toBeVisible({ timeout: 5000 });

      // Verify the pending invitation appears in the editors list
      const pendingSection = page.locator('.editor-card--invitation');
      await expect(pendingSection).toBeVisible({ timeout: 5000 });
      await expect(page.getByText(INVITEE_EMAIL)).toBeVisible({ timeout: 3000 });
    });

    test('should verify invitation email was sent', async () => {
      // Wait for the invitation email to arrive
      const email = await waitForEmail(env.baseURL, INVITEE_EMAIL, { timeout: 10000 });
      expect(email).not.toBeNull();
      expect(email.subject).toBeTruthy();

      // Verify the email was addressed to the correct recipient
      if (Array.isArray(email.to)) {
        expect(email.to).toContain(INVITEE_EMAIL);
      }
      else {
        expect(email.to).toBe(INVITEE_EMAIL);
      }

      // Verify the email text content exists
      expect(email.text).toBeTruthy();
    });

    test('should accept invitation and verify editor appears in list', async ({ page }) => {
      // Regression guard: the editor invitation email itself must carry a usable
      // /auth/invitation?code= link. Accepting that code creates the account and
      // grants editor access without any admin-side workaround.

      // Read the editor invitation email sent by the invite test
      const email = await waitForEmail(env.baseURL, INVITEE_EMAIL, { timeout: 10000 });
      expect(email).not.toBeNull();

      // Extract the invitation code from the email
      // Try text body first, then HTML, then raw MIME (where = is encoded as =3D)
      let inviteCode: string | null = null;

      if (email.text) {
        const textMatch = email.text.match(/\/auth\/invitation\?code=([a-f0-9]+)/);
        if (textMatch) inviteCode = textMatch[1];
      }

      if (!inviteCode && email.html) {
        const htmlMatch = email.html.match(/\/auth\/invitation\?code=([a-f0-9]+)/);
        if (htmlMatch) inviteCode = htmlMatch[1];
      }

      if (!inviteCode && email.raw) {
        // In MIME encoding, = may be encoded as =3D
        const rawMatch = email.raw.match(/code(?:=3D|=)([a-f0-9]+)/);
        if (rawMatch) inviteCode = rawMatch[1];
      }

      expect(inviteCode).not.toBeNull();
      console.log(`[Test] Extracted invitation code: ${inviteCode!.substring(0, 8)}...`);

      // Accept the editor invitation via API: creates the account and grants editor access
      const acceptResponse = await axios.post(
        `${env.baseURL}/api/v1/invitations/${inviteCode}`,
        { password: INVITEE_PASSWORD },
      );
      expect(acceptResponse.status).toBe(200);

      // Navigate to calendar management page and verify editor appears
      await page.goto(env.baseURL + '/calendar/test_calendar/manage');
      await page.waitForTimeout(2000);
      await page.waitForTimeout(1000);

      // The editor's email should appear in the active editors list
      const editorCard = page.locator('.editor-card:not(.editor-card--invitation)').filter({
        hasText: INVITEE_EMAIL,
      });
      await expect(editorCard).toBeVisible({ timeout: 5000 });
    });

    test('should remove an editor from the calendar', async ({ page }) => {
      // Navigate to calendar management page as admin
      await page.goto(env.baseURL + '/calendar/test_calendar/manage');
      await page.waitForTimeout(2000);
      await page.waitForTimeout(1000);

      // Find the editor card with the invitee's email
      const editorCard = page.locator('.editor-card:not(.editor-card--invitation)').filter({
        hasText: INVITEE_EMAIL,
      });
      await expect(editorCard).toBeVisible({ timeout: 5000 });

      // Click the Remove button on the editor card
      const removeButton = editorCard.locator('button').filter({ hasText: /Remove/i });
      await removeButton.click();

      // Wait for confirmation modal to appear
      const confirmModal = page.locator('dialog.modal[open]');
      await expect(confirmModal).toBeVisible({ timeout: 5000 });

      // Confirm removal by clicking the Remove button in the modal (danger variant)
      const confirmRemoveButton = confirmModal.locator('button.pill-button--danger');
      await confirmRemoveButton.click();

      // Wait for the removal to complete
      await page.waitForTimeout(2000);

      // Verify the editor was removed - the email should no longer appear
      const removedEditor = page.locator('.editor-card').filter({
        hasText: INVITEE_EMAIL,
      });
      await expect(removedEditor).toHaveCount(0);

      // Verify success message
      const successAlert = page.locator('.alert--success');
      await expect(successAlert).toBeVisible({ timeout: 5000 });
    });
  });
});
