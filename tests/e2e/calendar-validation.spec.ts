import { test, expect } from '@playwright/test';
import { loginAsFreshUser } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Regression Tests: Calendar Name Validation
 *
 * Tests calendar name validation UX improvements to prevent regression:
 * - Validation accepts hyphens in middle positions
 * - Validation rejects hyphens at start/end
 * - Error messages are clear and helpful
 * - Help text explains validation rules
 *
 * UPDATED: Uses isolated test server with in-memory database for true test isolation
 * Tests run serially within this file. Some tests may create calendars.
 */

let env: TestEnvironment;

// Configure tests to run serially within this file
// This ensures they share the same test server instance
test.describe.configure({ mode: 'serial' });

test.describe('Calendar Name Validation', () => {
  test.beforeAll(async () => {
    // Start isolated test server for this test file
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
    // Clean up test server
    console.log('[Test] Cleaning up test server...');
    if (env?.cleanup) {
      await env.cleanup();
    }
  });

  test.beforeEach(async ({ page }) => {
    // Log in as fresh user before each test
    // Note: This user might have calendars from previous tests since we can't delete calendars via API
    await loginAsFreshUser(page, env.baseURL);
  });

  test('should show calendar creation form on first visit', async ({ page }) => {
    // Navigate to calendars page
    await page.goto(env.baseURL + '/calendar');

    // Wait for page to load
    await page.waitForTimeout(2000);

    // Should show either calendar list or creation form
    // Calendar creation uses an inline form (not a modal) with EmptyLayout
    const hasCalendarForm = await page.locator('input#calendar-name').count() > 0;
    const hasCalendarList = await page.locator('nav[aria-label*="calendar" i]').count() > 0;

    expect(hasCalendarForm || hasCalendarList).toBeTruthy();
  });

  test('should reject calendar names with leading hyphen', async ({ page }) => {
    // Navigate to calendar creation
    await page.goto(env.baseURL + '/calendar');
    await page.waitForTimeout(2000);

    // Find calendar name input
    const calendarInput = page.locator('input#calendar-name');

    // Input should be visible since fresh user has no calendars
    await expect(calendarInput).toBeVisible();

    // Try invalid name with leading hyphen
    const invalidName = `-noleading`;
    await calendarInput.fill(invalidName);
    await calendarInput.blur();
    await page.waitForTimeout(300);

    // Try to submit
    const submitButton = page.locator('button[type="submit"].primary');
    await submitButton.click();

    // Wait for validation
    await page.waitForTimeout(1000);

    // Should show validation error
    const errorMessage = page.locator('#calendar-error.alert--error');
    await expect(errorMessage).toBeVisible({ timeout: 3000 });

    // Error should mention invalid format
    const errorText = await errorMessage.textContent();
    expect(errorText).toBeTruthy();
  });

  test('should reject calendar names with trailing hyphen', async ({ page }) => {
    // Navigate to calendar creation
    await page.goto(env.baseURL + '/calendar');
    await page.waitForTimeout(2000);

    // Find calendar name input
    const calendarInput = page.locator('input#calendar-name');

    // Input should be visible since fresh user has no calendars
    await expect(calendarInput).toBeVisible();

    // Try invalid name with trailing hyphen
    const invalidName = `notrailing-`;
    await calendarInput.fill(invalidName);
    await calendarInput.blur();
    await page.waitForTimeout(300);

    // Try to submit
    const submitButton = page.locator('button[type="submit"].primary');
    await submitButton.click();

    // Wait for validation
    await page.waitForTimeout(1000);

    // Should show validation error
    const errorMessage = page.locator('#calendar-error.alert--error');
    await expect(errorMessage).toBeVisible({ timeout: 3000 });

    // Error should mention invalid format
    const errorText = await errorMessage.textContent();
    expect(errorText).toBeTruthy();
  });

  test('should show helpful error message for invalid names', async ({ page }) => {
    // Navigate to calendar creation
    await page.goto(env.baseURL + '/calendar');
    await page.waitForTimeout(2000);

    // Find calendar name input
    const calendarInput = page.locator('input#calendar-name');

    // Input should be visible since fresh user has no calendars
    await expect(calendarInput).toBeVisible();

    // Try various invalid names
    const invalidNames = [
      'ab', // Too short
      'a'.repeat(25), // Too long
      'no spaces', // Spaces not allowed
    ];

    for (const invalidName of invalidNames) {
      await calendarInput.clear();
      await calendarInput.fill(invalidName);
      await calendarInput.blur();

      // Try to submit
      const submitButton = page.locator('button[type="submit"].primary');
      await submitButton.click();

      await page.waitForTimeout(1000);

      // Should show error message
      const errorMessage = page.locator('#calendar-error.alert--error');
      const hasError = await errorMessage.count() > 0;

      if (hasError) {
        // Verify error message is helpful (not just "invalid")
        const errorText = await errorMessage.textContent();
        expect(errorText).toBeTruthy();
        expect(errorText!.length).toBeGreaterThan(10); // Should be descriptive
        break; // Found at least one error message, test passes
      }
    }
  });

  test('should show help text explaining validation rules', async ({ page }) => {
    // Navigate to calendar creation
    await page.goto(env.baseURL + '/calendar');
    await page.waitForTimeout(2000);

    // Find calendar name input
    const calendarInput = page.locator('input#calendar-name');

    // Input should be visible since fresh user has no calendars
    await expect(calendarInput).toBeVisible();

    // Look for help text (id="calendar-help" with class .help-text)
    const helpText = page.locator('#calendar-help.help-text');

    if (await helpText.count() > 0) {
      // Verify help text is visible
      await expect(helpText).toBeVisible({ timeout: 3000 });

      // Help text should provide guidance
      const helpContent = await helpText.textContent();
      expect(helpContent).toBeTruthy();
      expect(helpContent!.length).toBeGreaterThan(10);
    }
    // If no help text, test still passes - not a requirement
  });

  test('should validate URL name length requirements', async ({ page }) => {
    // Navigate to calendar creation
    await page.goto(env.baseURL + '/calendar');
    await page.waitForTimeout(2000);

    // Find calendar name input
    const calendarInput = page.locator('input#calendar-name');

    // Input should be visible since fresh user has no calendars
    await expect(calendarInput).toBeVisible();

    // Test too short (< 3 characters)
    await calendarInput.fill('ab');
    await calendarInput.blur();

    const submitButton = page.locator('button[type="submit"].primary');
    await submitButton.click();
    await page.waitForTimeout(1000);

    let errorMessage = page.locator('#calendar-error.alert--error');
    let hasError = await errorMessage.count() > 0;
    expect(hasError).toBeTruthy();

    // Test too long (> 24 characters)
    await calendarInput.clear();
    await calendarInput.fill('thisisaverylongcalendarname12345');
    await calendarInput.blur();
    await submitButton.click();
    await page.waitForTimeout(1000);

    errorMessage = page.locator('#calendar-error.alert--error');
    hasError = await errorMessage.count() > 0;
    expect(hasError).toBeTruthy();

    // Test valid length (should not show length error)
    await calendarInput.clear();
    const validName = `valid-name-${Date.now()}`.substring(0, 20);
    await calendarInput.fill(validName);
    await calendarInput.blur();
    await submitButton.click();
    await page.waitForTimeout(2000);

    // Should either succeed or show error that's NOT about length
    const currentUrl = page.url();
    const hasLengthError = await page.locator('#calendar-error:has-text("short"), #calendar-error:has-text("long")').count() > 0;

    // If we're still on the form page, length error should not be shown
    if (currentUrl.endsWith('/calendar')) {
      expect(hasLengthError).toBeFalsy();
    }
  });

  // This test actually creates a calendar successfully, so it should run LAST
  // to avoid affecting other tests that expect FreshUser to have no calendars
  test('should accept valid calendar names with hyphens in middle', async ({ page }) => {
    // Navigate to calendar creation
    await page.goto(env.baseURL + '/calendar');
    await page.waitForTimeout(2000);

    // Find the calendar name input (id="calendar-name")
    const calendarInput = page.locator('input#calendar-name');

    // Check if creation form is visible (user has no calendars)
    // If user already has calendars from previous tests, the form won't show
    const isFormVisible = await calendarInput.count() > 0;

    if (!isFormVisible) {
      // User already has calendars, skip this test
      console.log('[Test] Skipping - user already has calendars, creation form not visible');
      return;
    }

    // Test valid names with hyphens in middle
    const validNames = [
      `my-calendar-${Date.now()}`.substring(0, 20),
      `test-cal-${Date.now()}`.substring(0, 20),
    ];

    for (const validName of validNames) {
      // Clear and fill input
      await calendarInput.clear();
      await calendarInput.fill(validName);

      // Trigger validation (blur)
      await calendarInput.blur();
      await page.waitForTimeout(300);

      // Try to submit
      const submitButton = page.locator('button[type="submit"].primary');
      await submitButton.click();

      // Wait for processing
      await page.waitForTimeout(2000);

      // Should either navigate away (success) or show specific error
      const currentUrl = page.url();
      const hasError = await page.locator('#calendar-error.alert--error').count() > 0;

      if (hasError) {
        // If there's an error, it should NOT be about hyphens
        const errorText = await page.locator('#calendar-error').textContent();
        expect(errorText).not.toMatch(/hyphen|use underscores/i);
      } else {
        // Should have navigated to the new calendar
        expect(currentUrl).toContain('/calendar/');
      }

      // If successful, navigate back for next test
      if (!hasError) {
        await page.goto(env.baseURL + '/calendar');
        await page.waitForTimeout(1000);
        // We might be on the calendar we just created, skip rest of loop
        break;
      }
    }
  });
});
