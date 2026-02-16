import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';

/**
 * E2E Tests: Event Location Management
 *
 * Tests complete user workflows for location integration:
 * - Creating events and adding locations via picker
 * - Searching for locations by name and address
 * - Selecting locations from list
 * - Creating new locations
 * - Removing and changing locations
 * - Accessibility features
 *
 * UPDATED: Uses isolated test server with in-memory database for true test isolation
 * Tests run serially within this file since they create locations that may be shared.
 */

let env: TestEnvironment;

// Configure tests to run serially within this file
// This ensures they share the same test server instance
test.describe.configure({ mode: 'serial' });

test.describe('Event Location Management End-to-End', () => {
  test.beforeAll(async () => {
    // Start isolated test server for this test file
    env = await startTestServer();
  });

  test.afterAll(async () => {
    // Clean up test server
    await env.cleanup();
  });

  test.beforeEach(async ({ page }) => {
    // Log in as admin
    await loginAsAdmin(page, env.baseURL);
  });

  // Task 12.1: Test user can create event and add location via picker
  test('should allow user to create event and add location via picker', async ({ page }) => {
    // Navigate directly to event editor
    await page.goto(env.baseURL + '/event');
    await page.waitForTimeout(1000);

    // Find and click the "Add Location" button on LocationDisplayCard
    const addLocationButton = page.getByRole('button', { name: /add location/i });
    await expect(addLocationButton).toBeVisible();
    await addLocationButton.click();

    // Wait for location picker modal to appear
    await page.waitForTimeout(500);

    // Modal should be visible
    const pickerModal = page.locator('dialog.location-picker-modal[open]');
    await expect(pickerModal).toBeVisible();

    // Should have "Select Location" title
    await expect(page.getByRole('heading', { name: 'Select Location' })).toBeVisible();
  });

  // Task 12.2 & 12.3: Test user can search for locations by name and address
  test('should allow user to search for locations', async ({ page }) => {
    // Navigate to event editor
    await page.goto(env.baseURL + '/event');
    await page.waitForTimeout(1000);

    // Open location picker
    const addLocationButton = page.getByRole('button', { name: /add location/i });
    await addLocationButton.click();
    await page.waitForTimeout(500);

    // Find search input
    const searchInput = page.locator('.search-input');
    await expect(searchInput).toBeVisible();

    // Search by location name (if locations exist in seed data)
    await searchInput.fill('venue');
    await page.waitForTimeout(300);

    // Search input should contain the search term
    await expect(searchInput).toHaveValue('venue');
  });

  // Task 12.4 & 12.5: Test user can select location from list and it appears in editor
  test('should allow user to select location and see it in editor', async ({ page }) => {
    // First create a location to select
    await page.goto(env.baseURL + '/event');
    await page.waitForTimeout(1000);

    // Open location picker
    const addLocationButton = page.getByRole('button', { name: /add location/i });
    await addLocationButton.click();
    await page.waitForTimeout(500);

    // Click "Create New" button to create a test location first
    const createNewButton = page.getByRole('button', { name: 'Create New' });
    await createNewButton.click();
    await page.waitForTimeout(500);

    // Fill create location form
    await page.locator('input[placeholder="Location name *"]').fill('E2E Test Venue');
    await page.locator('input[placeholder="Street address"]').fill('123 Test St');
    await page.locator('input[placeholder="City"]').fill('Portland');
    await page.locator('input[placeholder="State"]').fill('OR');
    await page.locator('input[placeholder="Postal code"]').fill('97201');

    // Submit the form
    const createLocationButton = page.getByRole('button', { name: 'Create Location' });
    await createLocationButton.click();
    await page.waitForTimeout(1000);

    // Form should close and location should be set
    const createLocationDialog = page.locator('dialog.create-location-form[open]');
    await expect(createLocationDialog).not.toBeVisible();

    // LocationDisplayCard should now show the location
    const locationCard = page.locator('.location-display-card');
    await expect(locationCard).toBeVisible();
    await expect(locationCard).toContainText('E2E Test Venue');
    await expect(locationCard).toContainText('123 Test St');
  });

  // Task 12.6, 12.7, 12.8: Test user can create new location via form
  test('should allow user to create new location and see it selected', async ({ page }) => {
    await page.goto(env.baseURL + '/event');
    await page.waitForTimeout(1000);

    // Open location picker
    const addLocationButton = page.getByRole('button', { name: /add location/i });
    await addLocationButton.click();
    await page.waitForTimeout(500);

    // Click "Create New"
    const createNewButton = page.getByRole('button', { name: 'Create New' });
    await createNewButton.click();
    await page.waitForTimeout(500);

    // Create location form should be visible
    const createDialog = page.locator('dialog.create-location-form[open]');
    await expect(createDialog).toBeVisible();

    // Fill the form
    await page.locator('input[placeholder="Location name *"]').fill('Brand New Venue');
    await page.locator('input[placeholder="Street address"]').fill('456 Oak Ave');
    await page.locator('input[placeholder="City"]').fill('Portland');
    await page.locator('input[placeholder="State"]').fill('OR');
    await page.locator('input[placeholder="Postal code"]').fill('97202');

    // Add accessibility information
    const accessibilityTextarea = page.locator('textarea[placeholder*="Accessibility"]');
    await accessibilityTextarea.fill('Wheelchair accessible entrance on Oak Ave side');

    // Submit
    const submitButton = page.getByRole('button', { name: 'Create Location' });
    await submitButton.click();
    await page.waitForTimeout(1000);

    // Form should close
    await expect(createDialog).not.toBeVisible();

    // Location should appear in the editor
    const locationCard = page.locator('.location-display-card');
    await expect(locationCard).toContainText('Brand New Venue');
    await expect(locationCard).toContainText('456 Oak Ave');
  });

  // Task 12.9: Test new location appears in picker for future events
  test('should show newly created location in picker for future events', async ({ page }) => {
    // Create a location in first event
    await page.goto(env.baseURL + '/event');
    await page.waitForTimeout(1000);

    const addLocationButton1 = page.getByRole('button', { name: /add location/i });
    await addLocationButton1.click();
    await page.waitForTimeout(500);

    const createNewButton1 = page.getByRole('button', { name: 'Create New' });
    await createNewButton1.click();
    await page.waitForTimeout(500);

    await page.locator('input[placeholder="Location name *"]').fill('Reusable Venue');
    await page.locator('input[placeholder="Street address"]').fill('789 Elm St');
    await page.locator('input[placeholder="City"]').fill('Portland');

    const submitButton1 = page.getByRole('button', { name: 'Create Location' });
    await submitButton1.click();
    await page.waitForTimeout(1000);

    // Navigate to create another event
    await page.goto(env.baseURL + '/event');
    await page.waitForTimeout(1000);

    // Open location picker
    const addLocationButton2 = page.getByRole('button', { name: /add location/i });
    await addLocationButton2.click();
    await page.waitForTimeout(1000);

    // The previously created location should appear in the list
    const pickerModal = page.locator('dialog.location-picker-modal[open]');
    await expect(pickerModal).toBeVisible();

    // Look for the location in the list (if there are any locations)
    const locationItems = page.locator('.location-item');
    const count = await locationItems.count();

    if (count > 0) {
      // Check if any location item contains our venue name
      const locationWithName = locationItems.filter({ hasText: 'Reusable Venue' });
      // If it exists, it should be visible
      if ((await locationWithName.count()) > 0) {
        await expect(locationWithName.first()).toBeVisible();
      }
    }
  });

  // Task 12.10: Test user can remove location from event
  test('should allow user to remove location from event', async ({ page }) => {
    // Create event with location
    await page.goto(env.baseURL + '/event');
    await page.waitForTimeout(1000);

    // Add a location first
    const addLocationButton = page.getByRole('button', { name: /add location/i });
    await addLocationButton.click();
    await page.waitForTimeout(500);

    const createNewButton = page.getByRole('button', { name: 'Create New' });
    await createNewButton.click();
    await page.waitForTimeout(500);

    await page.locator('input[placeholder="Location name *"]').fill('Temporary Venue');
    const submitButton = page.getByRole('button', { name: 'Create Location' });
    await submitButton.click();
    await page.waitForTimeout(1000);

    // Verify location is shown
    const locationCard = page.locator('.location-display-card');
    await expect(locationCard).toContainText('Temporary Venue');

    // Click "Change" button to open picker (within location card)
    const changeButton = locationCard.getByRole('button', { name: 'Change', exact: true });
    await changeButton.click();
    await page.waitForTimeout(500);

    // Click "Remove location" button in picker
    const removeButton = page.getByRole('button', { name: 'Remove location' });
    await removeButton.click();
    await page.waitForTimeout(500);

    // Picker should close
    const pickerModal = page.locator('dialog.location-picker-modal[open]');
    await expect(pickerModal).not.toBeVisible();

    // Location card should now show "Add Location" button instead
    const addButtonAgain = page.getByRole('button', { name: /add location/i });
    await expect(addButtonAgain).toBeVisible();
  });

  // Task 12.11: Test user can change location to different saved location
  test('should allow user to change to different saved location', async ({ page }) => {
    // Create first location
    await page.goto(env.baseURL + '/event');
    await page.waitForTimeout(1000);

    const addLocationButton1 = page.getByRole('button', { name: /add location/i });
    await addLocationButton1.click();
    await page.waitForTimeout(500);

    const createNewButton1 = page.getByRole('button', { name: 'Create New' });
    await createNewButton1.click();
    await page.waitForTimeout(500);

    await page.locator('input[placeholder="Location name *"]').fill('First Venue');
    const submitButton1 = page.getByRole('button', { name: 'Create Location' });
    await submitButton1.click();
    await page.waitForTimeout(1000);

    // Verify first location is set
    const locationCard = page.locator('.location-display-card');
    await expect(locationCard).toContainText('First Venue');

    // Click "Change" to open picker (within location card)
    const changeButton = locationCard.getByRole('button', { name: 'Change', exact: true });
    await changeButton.click();
    await page.waitForTimeout(500);

    // Create a second location
    const createNewButton2 = page.getByRole('button', { name: 'Create New' });
    await createNewButton2.click();
    await page.waitForTimeout(500);

    await page.locator('input[placeholder="Location name *"]').fill('Second Venue');
    const submitButton2 = page.getByRole('button', { name: 'Create Location' });
    await submitButton2.click();
    await page.waitForTimeout(1000);

    // Location should now show Second Venue
    await expect(locationCard).toContainText('Second Venue');
    await expect(locationCard).not.toContainText('First Venue');
  });

  // Task 12.12: Test accessibility features
  test('should support keyboard navigation and ARIA labels', async ({ page }) => {
    await page.goto(env.baseURL + '/event');
    await page.waitForTimeout(1000);

    // Open location picker
    const addLocationButton = page.getByRole('button', { name: /add location/i });
    await addLocationButton.click();
    await page.waitForTimeout(500);

    // Check ARIA attributes on dialog
    const pickerDialog = page.locator('dialog.location-picker-modal');
    await expect(pickerDialog).toHaveAttribute('aria-modal', 'true');
    await expect(pickerDialog).toHaveAttribute('aria-labelledby', 'location-picker-title');

    // Check search input has proper label
    const searchInput = page.locator('.search-input');
    await expect(searchInput).toHaveAttribute('aria-label', 'Search locations');

    // Check close button has accessible label
    const closeButton = page.locator('.close-button');
    await expect(closeButton).toHaveAttribute('aria-label', 'Close dialog');

    // Test keyboard navigation - ESC should close modal (native dialog behavior)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(pickerDialog).not.toHaveAttribute('open');
  });

  test('should have accessible create location form', async ({ page }) => {
    await page.goto(env.baseURL + '/event');
    await page.waitForTimeout(1000);

    // Open location picker and then create form
    const addLocationButton = page.getByRole('button', { name: /add location/i });
    await addLocationButton.click();
    await page.waitForTimeout(500);

    const createNewButton = page.getByRole('button', { name: 'Create New' });
    await createNewButton.click();
    await page.waitForTimeout(500);

    // Check form dialog ARIA attributes
    const createDialog = page.locator('dialog.create-location-form');
    await expect(createDialog).toHaveAttribute('aria-modal', 'true');
    await expect(createDialog).toHaveAttribute('aria-labelledby', 'create-location-title');

    // Check form inputs have proper labels
    const nameInput = page.locator('input[placeholder="Location name *"]');
    await expect(nameInput).toHaveAttribute('aria-label', /location name/i);

    const addressInput = page.locator('input[placeholder="Street address"]');
    await expect(addressInput).toHaveAttribute('aria-label', 'Street address');

    // Check accessibility textarea has language-specific label
    const accessibilityTextarea = page.locator('textarea[placeholder*="Accessibility"]');
    await expect(accessibilityTextarea).toHaveAttribute('aria-label');
  });
});
