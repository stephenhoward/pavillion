import { test, expect, Page } from '@playwright/test';
import { loginAsAdmin } from '../helpers/auth';
import { pageScreenReader } from '../helpers/screen-reader';
import { gotoSettings, settingsLeaf } from '../helpers/settings-nav';
import { startTestServer, TestEnvironment } from '../helpers/test-server';

/**
 * E2E Test: Modal open/close screen-reader announcements
 *
 * Verifies what a screen reader user hears when a `<Modal>` opens and
 * closes, using the virtual screen reader driven by `pageScreenReader`.
 * `tests/e2e/modal-focus.spec.ts` asserts where DOM focus goes; this spec
 * asserts what is announced as a result, which also depends on the dialog's
 * role, `aria-modal` and `aria-labelledby` wiring.
 *
 * Target: the "Change Email" modal on the Security settings page — a
 * standard `<Modal>` whose trigger carries `aria-haspopup="dialog"`.
 *
 * The shared helper exposes only the last spoken phrase, but the open
 * contract is an ordering claim across several phrases (dialog first, then
 * its heading, then the focused field), so the spec reads the virtual
 * screen reader's phrase log directly through `spokenPhrases()` below.
 */

const TRIGGER_PHRASE = 'button, Change Email, has popup dialog';
const DIALOG_PHRASE = 'dialog, Change your email address, modal';
const HEADING_PHRASE = 'heading, Change your email address, level 2';

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

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

test.describe('Modal Screen Reader Announcements', () => {
  test.beforeAll(async () => {
    env = await startTestServer();
  });

  test.afterAll(async () => {
    if (env?.cleanup) {
      await env.cleanup();
    }
  });

  test('announces the dialog on open and the trigger on close', async ({ page }) => {
    // Attach before the first navigation so the init script is in place.
    const sr = await pageScreenReader(page);
    try {
      await loginAsAdmin(page, env.baseURL);
      await gotoSettings(page, env.baseURL, settingsLeaf.security);

      // Any helper call starts the session on the current document; it must
      // be running before the trigger is focused so focus changes are heard.
      await sr.lastPhrase();

      const trigger = page.getByRole('button', { name: 'Change Email' });
      await trigger.focus();
      await expect.poll(() => sr.lastPhrase()).toBe(TRIGGER_PHRASE);

      // Open: the dialog's role and name are announced first, then its
      // heading, and the announcement ends inside the dialog — the screen
      // reader cursor does not stay on the trigger.
      await clearSpokenPhrases(page);
      await trigger.click();
      const modal = page.locator('dialog[aria-modal="true"]');
      await expect(modal).toBeVisible({ timeout: 3000 });

      await expect.poll(() => sr.lastPhrase()).toMatch(/^textbox, new email address\b/);
      const openPhrases = await spokenPhrases(page);
      expect(openPhrases.slice(0, 2)).toEqual([DIALOG_PHRASE, HEADING_PHRASE]);
      expect(openPhrases).not.toContain(TRIGGER_PHRASE);

      // Close: focus returns to the trigger and the screen reader announces
      // it, so the user hears where they landed.
      await clearSpokenPhrases(page);
      await page.keyboard.press('Escape');
      await expect(modal).toBeHidden();
      await expect(trigger).toBeFocused();
      await expect.poll(() => sr.lastPhrase()).toBe(TRIGGER_PHRASE);
      expect(await spokenPhrases(page)).toEqual([TRIGGER_PHRASE]);
    }
    finally {
      await sr.stop();
    }
  });
});
