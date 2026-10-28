import { test, expect, Page } from '@playwright/test';
import authentication from '../../../src/client/locales/en/authentication.json' with { type: 'json' };
import { pageScreenReader } from '../helpers/screen-reader';
import { startTestServer, TestEnvironment } from '../helpers/test-server';

/**
 * E2E Test: Login error live-region announcement
 *
 * Verifies what a screen reader user hears when sign-in fails, using the
 * virtual screen reader driven by `pageScreenReader`. The login form shows
 * its error in `error-alert.vue`, a `role="alert"` container with
 * `aria-live="polite"`; the explicit `aria-live` wins over the role's
 * implicit assertive politeness, so the error is announced as
 * `polite: <message>`.
 *
 * The virtual screen reader announces a mutation only when it happens inside
 * a live region that is already in the document, so `error-alert.vue` keeps
 * its region mounted while empty and changes only its text. The first test
 * covers an existing error replaced by the credentials error; the second
 * covers the first failed sign-in, where the region exists but is empty.
 *
 * Live-region phrases are not the screen reader's current position, so the
 * spec reads the full spoken-phrase log through `spokenPhrases()` below.
 */

const t = authentication.login;
const CREDENTIALS_ERROR_PHRASE = `polite: ${t['400']}`;

/**
 * The virtual screen reader's full spoken-phrase log since the last clear.
 */
async function spokenPhrases(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as {
    virtual: { spokenPhraseLog: () => Promise<string[]> };
  }).virtual.spokenPhraseLog());
}

async function clearSpokenPhrases(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as {
    virtual: { clearSpokenPhraseLog: () => Promise<void> };
  }).virtual.clearSpokenPhraseLog());
}

async function submitInvalidCredentials(page: Page): Promise<void> {
  await page.getByLabel(t.email).fill('admin@pavillion.dev');
  await page.getByLabel(t.password).fill('not-the-admin-password');
  await page.getByRole('button', { name: t.login_button }).click();
}

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

test.describe('Login Error Screen Reader Announcement', () => {
  test.beforeAll(async () => {
    env = await startTestServer();
  });

  test.afterAll(async () => {
    if (env?.cleanup) {
      await env.cleanup();
    }
  });

  test('announces the credentials error through the live region', async ({ page }) => {
    // Attach before the first navigation so the init script is in place.
    const sr = await pageScreenReader(page);
    try {
      await page.goto(env.baseURL + '/auth/login');

      // Any helper call starts the session on the current document; it must
      // be running before the error changes so the mutation is observed.
      await sr.lastPhrase();

      // An empty submission fills the alert with the missing-login error.
      const alert = page.getByRole('alert');
      await page.getByRole('button', { name: t.login_button }).click();
      await expect(alert).toHaveText(t.MissingLogin);

      await clearSpokenPhrases(page);
      await submitInvalidCredentials(page);
      await expect(alert).toHaveText(t['400']);

      await expect.poll(() => spokenPhrases(page)).toContain(CREDENTIALS_ERROR_PHRASE);
    }
    finally {
      await sr.stop();
    }
  });

  test('announces the credentials error on the first failed sign-in', async ({ page }) => {
    const sr = await pageScreenReader(page);
    try {
      await page.goto(env.baseURL + '/auth/login');
      await sr.lastPhrase();

      await submitInvalidCredentials(page);
      await expect(page.getByRole('alert')).toHaveText(t['400']);

      await expect.poll(() => spokenPhrases(page)).toContain(CREDENTIALS_ERROR_PHRASE);
    }
    finally {
      await sr.stop();
    }
  });
});
