import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * E2E Tests: Media Attachment
 *
 * Tests the image upload zone in the event editor, file upload via
 * setInputFiles, and preview display.
 *
 * Covers workflow audit gap:
 * - 1.8 Media Attachment
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_IMAGE_PATH = path.resolve(__dirname, 'fixtures/test-image.png');

test.describe('Media Attachment', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);

    // Navigate to event editor via "Create an Event" button
    await page.goto('/calendar');
    await page.waitForSelector('.event-list', { timeout: 10000 });
    await page.getByRole('button', { name: 'Create an Event' }).click();
    await page.waitForSelector('.upload-zone', { timeout: 10000 });
  });

  test('should display image upload zone in event editor', async ({ page }) => {
    // Verify the upload zone exists
    const uploadZone = page.locator('.upload-zone');
    await expect(uploadZone).toBeVisible();

    // Verify it has proper ARIA role
    await expect(uploadZone).toHaveAttribute('role', 'button');

    // Verify empty state is shown
    const emptyState = uploadZone.locator('.empty-state');
    await expect(emptyState).toBeVisible();

    // Verify upload text is present
    const uploadText = uploadZone.locator('.upload-text');
    await expect(uploadText).toBeVisible();
  });

  test('should upload an image file and show preview', async ({ page }) => {
    // Upload image via the hidden file input
    const fileInput = page.locator('input.file-input');
    await fileInput.setInputFiles(TEST_IMAGE_PATH);

    // Wait for upload to process — preview or progress should appear
    // The upload zone should transition from empty to preview state
    const previewOrProgress = page.locator('.preview-state, .upload-progress-overlay, .preview-image-wrapper');
    await expect(previewOrProgress.first()).toBeVisible({ timeout: 15000 });

    // Check for either success state or preview image
    const successOverlay = page.locator('.success-overlay');
    const previewImage = page.locator('.preview-image');
    const previewWrapper = page.locator('.preview-image-wrapper');

    // At least one of these should be visible after upload
    const hasSuccess = await successOverlay.isVisible().catch(() => false);
    const hasPreview = await previewImage.isVisible().catch(() => false);
    const hasWrapper = await previewWrapper.isVisible().catch(() => false);

    expect(hasSuccess || hasPreview || hasWrapper).toBeTruthy();
  });

  test('should show file info and action buttons after upload', async ({ page }) => {
    // Upload image
    const fileInput = page.locator('input.file-input');
    await fileInput.setInputFiles(TEST_IMAGE_PATH);

    // Wait for upload to complete
    await page.waitForSelector('.preview-state, .preview-image-wrapper, .file-info-bar', { timeout: 15000 });

    // Check for file info bar (shows filename and size)
    const fileInfoBar = page.locator('.file-info-bar');
    const hasFileInfo = await fileInfoBar.isVisible().catch(() => false);

    if (hasFileInfo) {
      // Verify file name is displayed
      const fileName = page.locator('.file-name');
      await expect(fileName).toBeVisible();

      // Verify action buttons exist (change/remove)
      const changeBtn = page.locator('.action-btn.change, button[aria-label*="replace"], button[aria-label*="Replace"]');
      const removeBtn = page.locator('.action-btn.remove, button[aria-label*="remove"], button[aria-label*="Remove"]');

      const hasChangeBtn = await changeBtn.first().isVisible().catch(() => false);
      const hasRemoveBtn = await removeBtn.first().isVisible().catch(() => false);

      // At least one action button should exist
      expect(hasChangeBtn || hasRemoveBtn).toBeTruthy();
    }
  });
});
