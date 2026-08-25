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

  // One worker everywhere, not just on CI.
  //
  // Every spec shares the same two Docker instances, and that shared state is
  // not read-only: `signature_strict_receive.spec.ts` toggles beta's signature
  // enforcement by force-recreating the beta container mid-run. Concurrent
  // workers see that container go away and fail in fixture setup with a 502
  // from nginx — failures that belong to no spec in particular and that CI,
  // already pinned to one worker, never reproduced. Serial execution is what
  // the fixture topology actually supports; `fullyParallel` above still
  // governs ordering within a file.
  //
  // The container-recreate hazard specifically is additionally fenced off by
  // the project split below (`federation-strict-receive` depends on
  // `federation`), which holds even if this worker pin is overridden on the
  // command line.
  workers: 1,

  // Reporter to use - open: 'never' prevents auto-launching browser after tests
  reporter: [['html', { open: 'never' }]],

  // Shared settings for all the projects below
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    // Tests primarily interact with alpha.federation.local
    baseURL: 'http://alpha.federation.local',

    // Allow the self-signed certificates the federation environment generates
    ignoreHTTPSErrors: true,

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

  // Configure projects for federation testing.
  //
  // `signature_strict_receive.spec.ts` is split into its own project that
  // `dependencies` on the default project, so the scheduler will not start it
  // until every other federation spec has finished. That spec force-recreates
  // the beta container and flips SKIP_SIGNATURES for its window; a sibling
  // spec running during that window fails with connection-refused/502 or hits
  // strict-mode rejections it does not expect. Unlike the `workers: 1` pin
  // above, this ordering survives a `--workers N` override. Do not fold the
  // spec back into the default project or drop the `dependencies` edge.
  //
  // Note: `--project=federation-strict-receive` pulls in the full
  // `federation` project (dependencies ignore test filters); to run the
  // strict spec alone, add `--no-deps`.
  projects: [
    {
      name: 'federation',
      testIgnore: '**/signature_strict_receive.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        // Explicitly ensure headless mode for this project
        headless: true,
      },
    },
    {
      name: 'federation-strict-receive',
      testMatch: '**/signature_strict_receive.spec.ts',
      dependencies: ['federation'],
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
      },
    },
  ],

  // No webServer configuration
  // Federation tests use externally started Docker environment
  // Start with: npm run federation:start
  // webServer: null is implicit when not specified
});
