import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for single-instance E2E testing
 *
 * This config runs tests with isolated test environments:
 * - Each test file gets its own server instance
 * - Each server runs on a unique port (auto-allocated 3100-3200)
 * - Each server has its own in-memory database
 * - Tests can run in parallel without conflicts
 *
 * Federation tests are in a separate config (playwright.federation.config.ts).
 *
 * Key features:
 * - testDir: ./tests/e2e (excludes ./tests/e2e/federation via testIgnore)
 * - Test files manage their own server lifecycle (beforeAll/afterAll)
 * - True test isolation with no shared state
 * - Full parallelization support
 *
 * Widget embedding tests (forthcoming: widget-embedding.spec.ts, bead pv-p2nm.3) use:
 * - A static file server on port 8080 (serves tests/e2e/ directory)
 * - The embedding page accepts ?serverUrl= to point at the dynamic test server
 * - This creates cross-origin testing (port 8080 vs port 3100-3200)
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
  // Use 2 workers locally to reduce port allocation race conditions
  workers: process.env.CI ? 1 : 2,

  // Reporter to use - prevent browser from opening after tests
  reporter: [['html', { open: 'never' }]],

  // Shared settings for all the projects below
  use: {
    // Note: baseURL is NOT set globally - each test file provides its own
    // via the test server helper (tests/e2e/helpers/test-server.ts)

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

  // Static file server for widget embedding tests
  // Serves tests/e2e/ directory on port 8080 for cross-origin widget testing.
  // The embedding page (test-widget-embedding.html) accepts a ?serverUrl= query
  // parameter pointing to the dynamic Pavillion test server instance.
  // This creates a true cross-origin scenario: port 8080 (embedding page) vs
  // port 3100-3200 (Pavillion app with widget).
  // Note: Most test files use their own isolated server (see test-server.ts helper)
  webServer: {
    command: 'npx http-server tests/e2e -p 8080 --silent',
    port: 8080,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
