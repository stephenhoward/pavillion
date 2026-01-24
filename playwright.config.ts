import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for single-instance E2E testing
 *
 * This config runs tests for a single Pavillion instance against localhost:3000.
 * Federation tests are in a separate config (playwright.federation.config.ts).
 *
 * Key features:
 * - testDir: ./tests/e2e (excludes ./tests/e2e/federation via testIgnore)
 * - Starts local dev server automatically
 * - Tests basic calendar, event, and admin functionality
 * - No Docker infrastructure required
 *
 * Usage:
 *   npm run test:e2e
 *
 * For federation tests (requires Docker):
 *   npm run test:federation
 *
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests/e2e',

  // Exclude federation tests - they have their own config
  testIgnore: '**/federation/**',

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI
  workers: process.env.CI ? 1 : undefined,

  // Reporter to use - prevent browser from opening after tests
  reporter: [['html', { open: 'never' }]],

  // Shared settings for all the projects below
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    baseURL: 'http://localhost:3000',

    // Run in headless mode to prevent browser windows staying open
    headless: true,

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',
  },

  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Run your local dev server before starting the tests
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000, // 2 minutes to start server
  },
});
