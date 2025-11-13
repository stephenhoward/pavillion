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
    // Navigate to calendar management
    await page.goto('/calendar');

    // Wait for calendar list or redirect
    await page.waitForTimeout(2000);

    // If on calendar management page, look for categories link/button
    // Categories might be in navigation or tabs
    const categoriesLink = page.locator('a:has-text("Categories"), button:has-text("Categories"), [href*="categories"]');

    if (await categoriesLink.count() > 0) {
      await categoriesLink.first().click();
    }

    // Listen for network requests to detect 404 errors
    const failed404Requests: string[] = [];
    page.on('response', response => {
      if (response.status() === 404) {
        failed404Requests.push(response.url());
      }
    });

    // Wait for either category list or "Add Category" button
    await page.waitForSelector('button.primary:has-text("Add"), button:has-text("category")', { timeout: 10000 });

    // Verify no 404 errors occurred
    expect(failed404Requests).toHaveLength(0);
  });

  test('should create a new category successfully', async ({ page }) => {
    // Navigate to calendar
    await page.goto('/calendar');
    await page.waitForTimeout(2000);

    // Navigate to categories (implementation-specific)
    const categoriesLink = page.locator('a:has-text("Categories"), button:has-text("Categories")');
    if (await categoriesLink.count() > 0) {
      await categoriesLink.first().click();
    }

    // Click "Add Category" button (uses .primary class)
    const addButton = page.locator('button.primary').filter({ hasText: /add.*category|category/i }).first();
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

    // Fill in category name (CategoryEditor has input with class .form-control)
    const nameInput = page.locator('dialog[open] input.form-control[type="text"]').first();
    await nameInput.fill(categoryName);

    // Click "Create" button (primary button in modal)
    const createButton = page.locator('dialog[open] button.primary').filter({ hasText: /create/i });
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

    // Navigate to categories
    const categoriesLink = page.locator('a:has-text("Categories"), button:has-text("Categories")');
    if (await categoriesLink.count() > 0) {
      await categoriesLink.first().click();
    }

    // Look for first category edit button (uses .btn--secondary class within .category-item)
    const editButton = page.locator('.category-item .btn--secondary').filter({ hasText: /edit/i }).first();
    const editButtonExists = await editButton.count() > 0;

    if (editButtonExists) {
      // Click edit button
      await editButton.click();

      // Wait for dialog to open
      await page.waitForSelector('dialog.modal-dialog[open]', { timeout: 5000 });

      // Update category name
      const nameInput = page.locator('dialog[open] input.form-control[type="text"]').first();
      const updatedName = `Updated Category ${Date.now()}`;
      await nameInput.clear();
      await nameInput.fill(updatedName);

      // Click "Save" button
      const saveButton = page.locator('dialog[open] button.primary').filter({ hasText: /save|update/i }).first();
      await saveButton.click();

      // Wait for dialog to close
      await page.waitForSelector('dialog[open]', { state: 'hidden', timeout: 5000 });

      // Verify updated category appears in list
      await expect(page.locator(`.category-name:has-text("${updatedName}")`)).toBeVisible({ timeout: 10000 });
    } else {
      // No categories to edit - create one first
      const addButton = page.locator('button.primary').filter({ hasText: /add.*category/i }).first();
      await addButton.click();
      await page.waitForSelector('dialog.modal-dialog[open]');

      const categoryName = `Test Category ${Date.now()}`;
      const nameInput = page.locator('dialog[open] input.form-control[type="text"]').first();
      await nameInput.fill(categoryName);

      const createButton = page.locator('dialog[open] button.primary').filter({ hasText: /create/i });
      await createButton.click();
      await page.waitForSelector('dialog[open]', { state: 'hidden' });

      // Now edit it
      const newEditButton = page.locator('.category-item .btn--secondary').filter({ hasText: /edit/i }).first();
      await newEditButton.click();
      await page.waitForSelector('dialog.modal-dialog[open]');

      const nameInputEdit = page.locator('dialog[open] input.form-control[type="text"]').first();
      const updatedName = `Updated Category ${Date.now()}`;
      await nameInputEdit.clear();
      await nameInputEdit.fill(updatedName);

      const saveButton = page.locator('dialog[open] button.primary').filter({ hasText: /save/i }).first();
      await saveButton.click();
      await page.waitForSelector('dialog[open]', { state: 'hidden' });

      await expect(page.locator(`.category-name:has-text("${updatedName}")`)).toBeVisible({ timeout: 10000 });
    }
  });

  test('should delete a category', async ({ page }) => {
    // Navigate to calendar
    await page.goto('/calendar');
    await page.waitForTimeout(2000);

    // Navigate to categories
    const categoriesLink = page.locator('a:has-text("Categories"), button:has-text("Categories")');
    if (await categoriesLink.count() > 0) {
      await categoriesLink.first().click();
    }

    // Create a category to delete
    const addButton = page.locator('button.primary').filter({ hasText: /add.*category/i }).first();
    await addButton.click();
    await page.waitForSelector('dialog.modal-dialog[open]');

    const categoryName = `Delete Me ${Date.now()}`;
    const nameInput = page.locator('dialog[open] input.form-control[type="text"]').first();
    await nameInput.fill(categoryName);

    const createButton = page.locator('dialog[open] button.primary').filter({ hasText: /create/i });
    await createButton.click();
    await page.waitForSelector('dialog[open]', { state: 'hidden' });

    // Verify category was created
    await expect(page.locator(`.category-name:has-text("${categoryName}")`)).toBeVisible();

    // Find the category item containing this category
    const categoryItem = page.locator('.category-item').filter({ hasText: categoryName });

    // Click delete button within this category item (uses .btn--danger class)
    const deleteButton = categoryItem.locator('.btn--danger').filter({ hasText: /delete/i });
    await deleteButton.click();

    // Wait for confirmation dialog (ModalLayout wraps a dialog)
    await page.waitForSelector('dialog.modal-dialog[open]', { timeout: 5000 });

    // Click confirm delete button (danger button in modal)
    const confirmButton = page.locator('dialog[open] button.danger').filter({ hasText: /delete/i });
    await confirmButton.click();

    // Wait for dialog to close
    await page.waitForSelector('dialog[open]', { state: 'hidden', timeout: 5000 });

    // Verify category is removed from list
    await expect(page.locator(`.category-name:has-text("${categoryName}")`)).not.toBeVisible({ timeout: 5000 });
  });
});
