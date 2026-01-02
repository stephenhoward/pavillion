import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Federation E2E testing
 *
 * This config is used for testing ActivityPub federation between two
 * Pavillion instances running in Docker (alpha.federation.local and
 * beta.federation.local).
 *
 * Key differences from main playwright.config.ts:
 * - testDir points to federation-specific tests
 * - Longer timeout (60s) for federation operations
 * - webServer is disabled - uses external Docker environment
 * - baseURL set to alpha.federation.local
 * - headless: true explicitly set for CI/automated testing
 *
 * Prerequisites:
 * 1. Add to /etc/hosts:
 *    127.0.0.1 alpha.federation.local
 *    127.0.0.1 beta.federation.local
 * 2. Start federation environment: npm run federation:start
 * 3. Wait for instances to be healthy
 *
 * Usage:
 *   npm run test:federation
 *
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  // Federation tests are in a separate directory
  testDir: './tests/e2e/federation',

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI
  workers: process.env.CI ? 1 : undefined,

  // Reporter to use
  reporter: 'html',

  // Shared settings for all the projects below
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    // Tests primarily interact with alpha.federation.local
    baseURL: 'http://alpha.federation.local',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',

    // CRITICAL: Run in headless mode for automated testing
    // Never run in headed mode to avoid blocking test execution
    headless: true,
  },

  // Longer timeout for federation operations
  // Federation involves network calls between instances which can be slow
  timeout: 60000,

  // Expect timeout for assertions
  expect: {
    timeout: 10000,
  },

  // Configure projects for federation testing
  projects: [
    {
      name: 'federation',
      use: {
        ...devices['Desktop Chrome'],
        // Explicitly ensure headless mode for this project
        headless: true,
      },
    },
  ],

  // No webServer configuration
  // Federation tests use externally started Docker environment
  // Start with: npm run federation:start
  // webServer: null is implicit when not specified
});
