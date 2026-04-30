import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { startTestServer, TestEnvironment } from './helpers/test-server';
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
 *
 * UPDATED: Uses isolated test server with in-memory database for true test isolation
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_IMAGE_PATH = path.resolve(__dirname, 'fixtures/test-image.png');

let env: TestEnvironment;

test.describe('Media Attachment', () => {
  test.beforeAll(async () => {
    // Start isolated test server for this test file
    env = await startTestServer();
  });

  test.afterAll(async () => {
    // Clean up test server
    await env.cleanup();
  });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);

    // Navigate to event editor via "Create an Event" button
    await page.goto(env.baseURL + '/calendar');
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

    // After upload completes, the parent swaps ImageUpload for ImageWorkspace,
    // which renders the uploaded image. Wait for that — selectors inside
    // ImageUpload (.preview-image, .success-overlay) are racy because they
    // unmount once eventImage becomes truthy.
    const workspaceImage = page.locator('.image-workspace .workspace-image');
    await expect(workspaceImage).toBeVisible({ timeout: 15000 });
  });

  test('should show image workspace and action buttons after upload', async ({ page }) => {
    // Upload image
    const fileInput = page.locator('input.file-input');
    await fileInput.setInputFiles(TEST_IMAGE_PATH);

    // After upload completes, edit_event.vue swaps ImageUpload for ImageWorkspace
    // (v-if="eventImage" / v-else). Wait for the ImageWorkspace to appear — that's
    // the stable post-upload UI users actually see. Querying the ImageUpload's
    // transient .file-info-bar state is racy because that component unmounts.
    const workspace = page.locator('.image-workspace');
    await expect(workspace).toBeVisible({ timeout: 15000 });

    // The uploaded image should be rendered in the workspace
    await expect(workspace.locator('.workspace-image')).toBeVisible();

    // Replace and remove action buttons should be present in the workspace
    const actionButtons = workspace.locator('.action-buttons button');
    await expect(actionButtons).toHaveCount(2);
  });
});
