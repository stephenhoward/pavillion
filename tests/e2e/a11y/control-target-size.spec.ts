import { test, expect } from '@playwright/test';
import { startTestServer, TestEnvironment } from '../helpers/test-server';
import { loginAsAdmin } from '../helpers/auth';

/**
 * Checkbox and radio sizing is a page-wide invariant, not a per-component one:
 * a single base-layer rule can inflate every control in the client at once, and
 * that is exactly how pv-993j happened — a blanket `min-width/min-height: 44px`
 * on `input[type="checkbox"], input[type="radio"]` held every control open at
 * 44x44, because a min-* floor is not overridable by a component's width/height
 * at any specificity.
 *
 * So this walks whole screens rather than named components, and asserts both
 * halves of the contract at once:
 *
 *   1. The painted control stays near its designed box (~18px). A control much
 *      larger than that means something is inflating it again.
 *   2. The pointer target — the label that wraps or names the control, or the
 *      control itself when it has neither — still clears WCAG 2.2 SC 2.5.8
 *      (Target Size (Minimum), AA, 24x24 CSS px).
 *
 * The two together are what stops a future fix for one from re-breaking the
 * other: inflating the control satisfies (2) by violating (1), and shrinking the
 * control without giving the label a target satisfies (1) by violating (2).
 */

/** A control wider or taller than this is being inflated past its designed box. */
const MAX_CONTROL_SIZE = 24;

/** WCAG 2.2 SC 2.5.8 Target Size (Minimum), level AA. */
const MIN_TARGET_SIZE = 24;

interface ControlReport {
  label: string;
  control: string;
  target: string;
  targetFrom: string;
}

/**
 * Measures every visible checkbox and radio on the current page, pairing each
 * control's painted box with the box a pointer actually has to hit.
 */
async function measureControls(page: import('@playwright/test').Page): Promise<ControlReport[]> {
  return page.evaluate(() => {
    const round = (n: number) => Math.round(n * 10) / 10;

    return [...document.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"], input[type="radio"]',
    )]
      .filter((el) => {
        const style = getComputedStyle(el);
        // A control the component hides on purpose (the recurrence weekday
        // chips draw their own pill from a sibling) has no painted box and no
        // pointer target of its own; the visible sibling carries both.
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (style.opacity === '0' || style.pointerEvents === 'none') return false;
        return el.getBoundingClientRect().width > 0;
      })
      .map((el) => {
        const control = el.getBoundingClientRect();

        const wrapping = el.closest('label');
        const named = el.id
          ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(el.id)}"]`)
          : null;
        const targetEl = wrapping ?? named ?? el;
        const target = targetEl.getBoundingClientRect();

        let targetFrom = 'control itself';
        if (targetEl === wrapping) targetFrom = 'wrapping label';
        else if (targetEl === named) targetFrom = 'label[for]';

        return {
          label: el.getAttribute('aria-label')
            || (wrapping?.textContent || named?.textContent || '').trim().slice(0, 40)
            || el.name
            || '(unnamed)',
          control: `${round(control.width)}x${round(control.height)}`,
          target: `${round(target.width)}x${round(target.height)}`,
          targetFrom,
        };
      });
  });
}

function parseBox(box: string): { width: number; height: number } {
  const [width, height] = box.split('x').map(Number);
  return { width, height };
}

function assertControlsAreWellSized(controls: ControlReport[], surface: string) {
  expect(controls.length, `expected ${surface} to have checkboxes or radios to measure`)
    .toBeGreaterThan(0);

  const inflated = controls.filter((c) => {
    const { width, height } = parseBox(c.control);
    return width > MAX_CONTROL_SIZE || height > MAX_CONTROL_SIZE;
  });
  expect(inflated, `controls inflated past their designed box on ${surface}`).toEqual([]);

  const undersizedTargets = controls.filter((c) => {
    const { width, height } = parseBox(c.target);
    return width < MIN_TARGET_SIZE || height < MIN_TARGET_SIZE;
  });
  expect(undersizedTargets, `pointer targets below ${MIN_TARGET_SIZE}px on ${surface}`)
    .toEqual([]);
}

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

test.describe('Checkbox and radio target size', () => {
  test.beforeAll(async () => {
    env = await startTestServer();
  });

  test.afterAll(async () => {
    if (env?.cleanup) {
      await env.cleanup();
    }
  });

  test('event list selection checkboxes keep their box and their target', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);

    // The bulk-selection checkboxes are the densest checkbox surface in the
    // client and the two shapes differ: "select all" sits in a label with text,
    // each row's checkbox in a label with none.
    await page.locator('.event-list .event-checkbox input[type="checkbox"]').first()
      .waitFor({ state: 'visible' });

    assertControlsAreWellSized(await measureControls(page), 'the calendar event list');
  });

  test('recurrence editor checkboxes and radios keep their box and their target', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
    await page.goto(env.baseURL + '/event');

    await page.getByRole('button', { name: 'Add recurrence' }).click();
    await page.locator('select.frequency-select').selectOption('Monthly');

    // The monthly grid is 35 checkboxes in labelled rows plus the end-type
    // radios — the surface where pv-993j was most visible.
    await page.locator('.month-parameters input[type="checkbox"]').first()
      .waitFor({ state: 'visible' });

    assertControlsAreWellSized(await measureControls(page), 'the recurrence editor');
  });
});

/**
 * The base layer floors only controls (`button`, `[role="button"]`, `select`)
 * at 44x44; links are exempt, so a component's declared size is what renders.
 * The AA bar is WCAG 2.2 SC 2.5.8 (24x24), so every visible control must clear
 * that on a full screen, and the few places that opt out or opt in are pinned
 * individually.
 */
async function measureSmallControls(page: import('@playwright/test').Page) {
  return page.evaluate((min) => {
    return [...document.querySelectorAll<HTMLElement>('button, [role="button"], select')]
      .filter((el) => {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (style.opacity === '0' || style.pointerEvents === 'none') return false;
        // Visually hidden skip links are clipped to 1x1 on purpose.
        if (el.closest('.sr-only') || el.classList.contains('sr-only')) return false;
        return el.getBoundingClientRect().width > 0;
      })
      .map((el) => {
        const box = el.getBoundingClientRect();
        return {
          el: `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80),
          text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30),
          width: Math.round(box.width * 10) / 10,
          height: Math.round(box.height * 10) / 10,
        };
      })
      .filter((c) => c.width < min || c.height < min);
  }, MIN_TARGET_SIZE);
}

test.describe('Control and link target size', () => {
  test.beforeAll(async () => {
    env = await startTestServer();
  });

  test.afterAll(async () => {
    if (env?.cleanup) {
      await env.cleanup();
    }
  });

  test('a self-declared link keeps a 44px target on the login page', async ({ page }) => {
    await page.goto(env.baseURL + '/auth/login');
    const link = page.locator('a.forgot').first();
    await link.waitFor({ state: 'visible' });
    const box = await link.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('a standalone link is no longer floored but clears the 24px minimum', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
    const link = page.locator('.calendar-public-link').first();
    await link.waitFor({ state: 'visible' });
    const box = await link.boundingBox();
    expect(box!.height).toBeLessThan(44);
    expect(box!.height).toBeGreaterThanOrEqual(MIN_TARGET_SIZE);
  });

  test('a select keeps the 44px floor', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
    await page.goto(env.baseURL + '/event');
    await page.getByRole('button', { name: 'Add recurrence' }).click();
    const select = page.locator('select.frequency-select');
    await select.waitFor({ state: 'visible' });
    const box = await select.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('every control on the calendar page and event editor clears 24x24', async ({ page }) => {
    await loginAsAdmin(page, env.baseURL);
    await page.locator('.event-list').first().waitFor({ state: 'visible' });
    expect(await measureSmallControls(page), 'undersized controls on the calendar page')
      .toEqual([]);

    await page.goto(env.baseURL + '/event');
    await page.getByRole('button', { name: 'Add recurrence' }).click();
    expect(await measureSmallControls(page), 'undersized controls on the event editor')
      .toEqual([]);
  });
});
