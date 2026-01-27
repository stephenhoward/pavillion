import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

/**
 * E2E Regression Tests: Category CRUD Workflow
 *
 * Tests the complete category management workflow to prevent regression
 * of issues identified in QA testing:
 * - Category list loading without 404 errors
 * - Category creation dialog functionality
 * - Category editing
 * - Category deletion
 *
 * UPDATED: Selectors based on actual Vue component DOM structure
 */

test.describe('Category CRUD Workflow', () => {
  test.beforeEach(async ({ page }) => {
    // Log in as admin before each test
    await loginAsAdmin(page);
  });

  test('should load category list without 404 errors', async ({ page }) => {
    // Navigate to calendar - this will redirect to the user's calendar
    await page.goto('/calendar');

    // Wait for calendar view to load
    await page.waitForTimeout(2000);

    // Click "Manage" button to access calendar management (PillButton rendered as <button>)
    const manageLink = page.locator('button:has-text("Manage"), a:has-text("Manage"), a[href*="/manage"]').first();
    await manageLink.click();

    // Wait for management page to load
    await page.waitForTimeout(1000);

    // Categories tab should be active by default, but click it to be sure
    const categoriesTab = page.locator('button[role="tab"]:has-text("Categories")');
    if (await categoriesTab.count() > 0) {
      await categoriesTab.click();
    }

    // Listen for network requests to detect 404 errors
    const failed404Requests: string[] = [];
    page.on('response', response => {
      if (response.status() === 404) {
        failed404Requests.push(response.url());
      }
    });

    // Wait for either category list or "Add Category" button
    await page.waitForSelector('.pill-button--primary, .category-card', { timeout: 10000 });

    // Verify no 404 errors occurred
    expect(failed404Requests).toHaveLength(0);
  });

  test('should create a new category successfully', async ({ page }) => {
    // Navigate to calendar
    await page.goto('/calendar');
    await page.waitForTimeout(2000);

    // Click "Manage" button to access calendar management (PillButton rendered as <button>)
    const manageLink = page.locator('button:has-text("Manage"), a:has-text("Manage"), a[href*="/manage"]').first();
    await manageLink.click();
    await page.waitForTimeout(1000);

    // Click Categories tab
    const categoriesTab = page.locator('button[role="tab"]:has-text("Categories")');
    if (await categoriesTab.count() > 0) {
      await categoriesTab.click();
    }

    // Click "Add Category" button (PillButton with pill-button--primary class)
    const addButton = page.locator('.pill-button--primary').filter({ hasText: /add.*category|category/i }).first();
    await addButton.click();

    // Wait for modal dialog to open (native HTML dialog element)
    await page.waitForSelector('dialog.modal-dialog[open]', { timeout: 5000 });

    // Check for console errors during dialog opening
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Generate unique category name
    const categoryName = `Test Category ${Date.now()}`;

    // Fill in category name (CategoryEditor has input with class .language-input)
    const nameInput = page.locator('dialog[open] input.language-input[type="text"]').first();
    await nameInput.fill(categoryName);

    // Click "Create" button (PillButton primary in modal)
    const createButton = page.locator('dialog[open] .pill-button--primary').filter({ hasText: /create/i });
    await createButton.click();

    // Wait for dialog to close
    await page.waitForSelector('dialog[open]', { state: 'hidden', timeout: 5000 });

    // Verify category appears in list (uses .category-name class)
    await expect(page.locator(`.category-name:has-text("${categoryName}")`)).toBeVisible({ timeout: 10000 });

    // Verify no console errors occurred
    const relevantErrors = consoleErrors.filter(err =>
      !err.includes('Deprecation') &&
      !err.includes('[vite]') &&
      !err.includes('404')
    );
    expect(relevantErrors).toHaveLength(0);
  });

  test('should edit an existing category', async ({ page }) => {
    // Navigate to calendar
    await page.goto('/calendar');
    await page.waitForTimeout(2000);

    // Click "Manage" button to access calendar management (PillButton rendered as <button>)
    const manageLink = page.locator('button:has-text("Manage"), a:has-text("Manage"), a[href*="/manage"]').first();
    await manageLink.click();
    await page.waitForTimeout(1000);

    // Click Categories tab
    const categoriesTab = page.locator('button[role="tab"]:has-text("Categories")');
    if (await categoriesTab.count() > 0) {
      await categoriesTab.click();
    }

    // Look for first category edit button (icon-button within .category-card, identified by aria-label)
    const editButton = page.locator('.category-card .icon-button:not(.icon-button--danger)').first();
    const editButtonExists = await editButton.count() > 0;

    if (editButtonExists) {
      // Click edit button
      await editButton.click();

      // Wait for dialog to open
      await page.waitForSelector('dialog.modal-dialog[open]', { timeout: 5000 });

      // Update category name
      const nameInput = page.locator('dialog[open] input.language-input[type="text"]').first();
      const updatedName = `Updated Category ${Date.now()}`;
      await nameInput.clear();
      await nameInput.fill(updatedName);

      // Click "Save" button (PillButton primary in modal)
      const saveButton = page.locator('dialog[open] .pill-button--primary').filter({ hasText: /save|update/i }).first();
      await saveButton.click();

      // Wait for dialog to close
      await page.waitForSelector('dialog[open]', { state: 'hidden', timeout: 5000 });

      // Verify updated category appears in list
      await expect(page.locator(`.category-name:has-text("${updatedName}")`)).toBeVisible({ timeout: 10000 });
    } else {
      // No categories to edit - create one first
      const addButton = page.locator('.pill-button--primary').filter({ hasText: /add.*category/i }).first();
      await addButton.click();
      await page.waitForSelector('dialog.modal-dialog[open]');

      const categoryName = `Test Category ${Date.now()}`;
      const nameInput = page.locator('dialog[open] input.language-input[type="text"]').first();
      await nameInput.fill(categoryName);

      const createButton = page.locator('dialog[open] .pill-button--primary').filter({ hasText: /create/i });
      await createButton.click();
      await page.waitForSelector('dialog[open]', { state: 'hidden' });

      // Now edit it
      const newEditButton = page.locator('.category-card .icon-button:not(.icon-button--danger)').first();
      await newEditButton.click();
      await page.waitForSelector('dialog.modal-dialog[open]');

      const nameInputEdit = page.locator('dialog[open] input.language-input[type="text"]').first();
      const updatedName = `Updated Category ${Date.now()}`;
      await nameInputEdit.clear();
      await nameInputEdit.fill(updatedName);

      const saveButton = page.locator('dialog[open] .pill-button--primary').filter({ hasText: /save/i }).first();
      await saveButton.click();
      await page.waitForSelector('dialog[open]', { state: 'hidden' });

      await expect(page.locator(`.category-name:has-text("${updatedName}")`)).toBeVisible({ timeout: 10000 });
    }
  });

  test('should delete a category', async ({ page }) => {
    // Navigate to calendar
    await page.goto('/calendar');
    await page.waitForTimeout(2000);

    // Click "Manage" button to access calendar management (PillButton rendered as <button>)
    const manageLink = page.locator('button:has-text("Manage"), a:has-text("Manage"), a[href*="/manage"]').first();
    await manageLink.click();
    await page.waitForTimeout(1000);

    // Click Categories tab
    const categoriesTab = page.locator('button[role="tab"]:has-text("Categories")');
    if (await categoriesTab.count() > 0) {
      await categoriesTab.click();
    }

    // Create a category to delete
    const addButton = page.locator('.pill-button--primary').filter({ hasText: /add.*category/i }).first();
    await addButton.click();
    await page.waitForSelector('dialog.modal-dialog[open]');

    const categoryName = `Delete Me ${Date.now()}`;
    const nameInput = page.locator('dialog[open] input.language-input[type="text"]').first();
    await nameInput.fill(categoryName);

    const createButton = page.locator('dialog[open] .pill-button--primary').filter({ hasText: /create/i });
    await createButton.click();
    await page.waitForSelector('dialog[open]', { state: 'hidden' });

    // Verify category was created
    await expect(page.locator(`.category-name:has-text("${categoryName}")`)).toBeVisible();

    // Find the category card containing this category
    const categoryItem = page.locator('.category-card').filter({ hasText: categoryName });

    // Click delete button within this category card (icon-button with --danger modifier)
    const deleteButton = categoryItem.locator('.icon-button--danger');
    await deleteButton.click();

    // Wait for confirmation dialog (ModalLayout wraps a dialog)
    await page.waitForSelector('dialog.modal-dialog[open]', { timeout: 5000 });

    // Select "remove" option (required to enable delete button)
    const removeOption = page.locator('dialog[open] input[type="radio"][value="remove"]');
    await removeOption.click();

    // Click confirm delete button (PillButton danger in modal)
    const confirmButton = page.locator('dialog[open] .pill-button--danger').filter({ hasText: /delete/i });
    await confirmButton.click();

    // Wait for dialog to close
    await page.waitForSelector('dialog[open]', { state: 'hidden', timeout: 5000 });

    // Verify category is removed from list
    await expect(page.locator(`.category-name:has-text("${categoryName}")`)).not.toBeVisible({ timeout: 5000 });
  });
});
