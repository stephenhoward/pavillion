import { test, expect, Browser, Page } from '@playwright/test';
import { startTestServer, TestEnvironment } from './helpers/test-server';
import { Theme, expectLegible } from './helpers/color-mode';
import { Rgba, surfaceOf, contrastRatio } from '@/common/test-utils/color-contrast';

/**
 * E2E Tests: forced-colors smoke
 *
 * Under an OS forced-colors (high-contrast) theme the browser replaces the
 * page's colours with the user's system palette, so this spec asserts only
 * what stays the page's responsibility, on the event page, the calendar with
 * its date filter open, and the widget:
 *
 * - every keyboard focus stop draws an outline (a box-shadow ring, which
 *   forced colors removes, would leave focus invisible);
 * - sampled text, and the custom date input's border, stand out from the
 *   surface they are painted on;
 * - the custom date input's picker indicator is painted at full strength
 *   rather than dimmed by its resting opacity.
 *
 * Both OS colour schemes are covered, since Chromium derives the emulated
 * system palette from the scheme (dark text on white, or white on black).
 *
 * Not asserted: the footer `.pavillion-logo` mask, whose `background-color`
 * forced colors does not override (a known, pre-existing issue tracked
 * outside this smoke). The widget's own "forced light/dark" colour modes are
 * a different feature, covered in widget-config-roundtrip.spec.ts.
 */

let env: TestEnvironment;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  env = await startTestServer();
});

test.afterAll(async () => {
  await env.cleanup();
});

/** Upper bound on focus stops walked per page; a page that wraps sooner stops there. */
const MAX_FOCUS_STOPS = 60;

interface FocusStop {
  target: string;
  outlineStyle: string;
  outlineWidth: number;
}

async function openForcedColors(
  browser: Browser,
  colorScheme: Theme,
): Promise<{ page: Page; cleanup: () => Promise<void> }> {
  const context = await browser.newContext({ forcedColors: 'active', colorScheme });
  const page = await context.newPage();
  return { page, cleanup: () => context.close() };
}

/**
 * Press Tab until focus wraps back to the document or `MAX_FOCUS_STOPS` is
 * reached, recording the computed outline of each focused element.
 *
 * A stop whose `activeElement` does not match `:focus` is skipped: Chromium
 * tabs onto a date input's own picker indicator, a browser-internal part that
 * draws its own focus ring, which the host input's computed style cannot see.
 */
async function walkFocus(page: Page): Promise<FocusStop[]> {
  const stops: FocusStop[] = [];
  for (let i = 0; i < MAX_FOCUS_STOPS; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) {
        return null;
      }
      if (!el.matches(':focus')) {
        return 'internal';
      }
      const style = getComputedStyle(el);
      const classes = typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).join('.')
        : '';
      return {
        target: `${el.tagName.toLowerCase()}${classes} "${(el.textContent ?? '').trim().slice(0, 30)}"`,
        outlineStyle: style.outlineStyle,
        outlineWidth: parseFloat(style.outlineWidth),
      };
    });
    if (!stop) {
      break;
    }
    if (stop !== 'internal') {
      stops.push(stop);
    }
  }
  return stops;
}

/** Assert that every focus stop draws a visible outline; returns the stops. */
async function expectFocusOutlines(page: Page): Promise<FocusStop[]> {
  const stops = await walkFocus(page);
  expect(stops.length, 'the page has keyboard focus stops').toBeGreaterThan(0);
  const unoutlined = stops.filter(s => s.outlineStyle === 'none' || !(s.outlineWidth > 0));
  expect(unoutlined, 'focus stops without an outline').toEqual([]);
  return stops;
}

/**
 * The highest contrast any pixel of a screenshot region reaches against the
 * region's most common colour (its background). The PNG is decoded on a
 * blank page, so the site's CSP never decides whether the canvas loads it.
 */
async function peakRegionContrast(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<number> {
  const png = await page.screenshot({ clip });
  const decoder = await page.context().newPage();
  let pixels: number[];
  try {
    pixels = await decoder.evaluate(async (base64) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + base64;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    }, png.toString('base64'));
  }
  finally {
    await decoder.close();
  }

  const colors: Rgba[] = [];
  const counts = new Map<string, number>();
  for (let i = 0; i < pixels.length; i += 4) {
    const color = { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a: 1 };
    colors.push(color);
    const key = `${color.r},${color.g},${color.b}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [backgroundKey] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const [r, g, b] = backgroundKey.split(',').map(Number);
  const background = { r, g, b, a: 1 };
  return Math.max(...colors.map(c => contrastRatio(`rgb(${c.r}, ${c.g}, ${c.b})`, background)));
}

/** Open the calendar's date filter and switch it to custom dates. */
async function openCustomDates(page: Page): Promise<void> {
  await page.goto(env.baseURL + '/test_calendar');
  await expect(page.locator('li.day-event-item').first()).toBeVisible({ timeout: 15000 });
  await page.locator('.date-filter-button').click();
  await expect(page.locator('.date-dropdown')).toBeVisible({ timeout: 15000 });
  await page.locator('.date-pill.calendar-pill').click();
  await expect(page.locator('.date-input').first()).toBeVisible({ timeout: 15000 });
}

for (const osScheme of ['light', 'dark'] as const) {
  test(`forced colors on a ${osScheme} OS keep focus and text visible`, async ({ browser }) => {
    const { page, cleanup } = await openForcedColors(browser, osScheme);

    await test.step('calendar with the date filter open', async () => {
      await openCustomDates(page);

      await expectLegible(page, '.calendar-title');
      await expectLegible(page, 'li.day-event-item h3');
      await expectLegible(page, '.date-filter-button');
      await expectLegible(page, '.date-input-label');
      await expectLegible(page, '.date-input');
      // The custom date field's edge is a non-text graphic: the 3:1 floor.
      await expectLegible(page, '.date-input', 'borderTopColor');

      // Focus sits on the custom-dates pill; walking on from it crosses the
      // date inputs and then the rest of the page.
      const stops = await expectFocusOutlines(page);
      expect(stops.some(s => s.target.startsWith('input.date-input')), 'the walk reached the date inputs').toBe(true);
    });

    await test.step('event page', async () => {
      // Navigate rather than click: the date popover may still cover the list.
      const href = await page.locator('li.day-event-item h3 a').first().getAttribute('href');
      await page.goto(env.baseURL + href);
      await expect(page.locator('.instance-title')).toBeVisible({ timeout: 15000 });

      await expectLegible(page, '.instance-title');
      await expectLegible(page, '.back-link');

      await expectFocusOutlines(page);
    });

    await test.step('widget', async () => {
      await page.goto(env.baseURL + '/widget/test_calendar?view=list');
      await expect(page.locator('.list-view .event-title-link').first()).toBeVisible({ timeout: 20000 });

      await expectLegible(page, '.list-view .event-title-link');
      await expectLegible(page, '.category-filter-section .filter-label');
      await expectLegible(page, '.widget-footer a');

      await expectFocusOutlines(page);
    });

    await cleanup();
  });
}

// Chromium's light forced-colors emulation paints no picker indicator at all,
// even on an unstyled date input, so the indicator is only measurable on the
// dark (white-on-black) palette.
test('forced colors paint the custom date picker indicator at full strength', async ({ browser }) => {
  const { page, cleanup } = await openForcedColors(browser, 'dark');
  await openCustomDates(page);

  // Park the pointer off the input so its resting (not hover) opacity shows.
  await page.locator('.date-input-label').first().hover();
  const input = page.locator('.date-input').first();
  const box = await input.boundingBox();
  expect(box).not.toBeNull();

  // The field's text contrast under the system palette, from computed
  // colours: the indicator should reach it, not a fraction of it.
  const probe = await input.evaluate((el) => {
    const backdrop: string[] = [];
    for (let node: Element | null = el; node; node = node.parentElement) {
      backdrop.push(getComputedStyle(node).backgroundColor);
    }
    return { color: getComputedStyle(el).color, backdrop };
  });
  const surface = surfaceOf(probe.backdrop);
  expect(surface).not.toBeNull();
  const textContrast = contrastRatio(probe.color, surface!);

  // The indicator sits at the input's inline end, inside its padding.
  const indicator = { x: box!.x + box!.width - 32, y: box!.y + 4, width: 28, height: box!.height - 8 };
  await expect.poll(
    () => peakRegionContrast(page, indicator),
    { message: 'picker indicator contrast against the field', timeout: 15000, intervals: [200, 500, 1000] },
  ).toBeGreaterThanOrEqual(textContrast * 0.9);

  await cleanup();
});
