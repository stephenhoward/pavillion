import { test, expect, Browser, Page } from '@playwright/test';
import { startTestServer, TestEnvironment } from './helpers/test-server';
import { Theme, expectLegible, MIN_NORMAL_TEXT_CONTRAST } from './helpers/color-mode';
import { Rgba, surfaceOf, contrastRatio } from '@/common/test-utils/color-contrast';

/**
 * E2E Tests: forced-colors smoke
 *
 * Under an OS forced-colors (high-contrast) theme the browser replaces the
 * page's colours with the user's system palette, so this spec asserts only
 * what stays the page's responsibility, on the calendar page (walked from the
 * document start, then again from the date filter with its custom dates
 * open), an event page, and the widget:
 *
 * - every keyboard focus stop, Tabbing until focus wraps, draws an outline
 *   (a box-shadow ring, which forced colors removes, would leave focus
 *   invisible);
 * - sampled text clears the 4.5:1 normal-text floor against the surface it
 *   is painted on, and the custom date input's border the 3:1 non-text one;
 * - the custom date input's picker indicator, on the site and the widget, is
 *   painted at full strength rather than dimmed by its resting opacity.
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

/**
 * Upper bound on Tab presses per walk. Every walk must wrap back to the
 * document before reaching it, so the bound only stops a focus trap from
 * hanging the test.
 */
const MAX_FOCUS_STOPS = 300;

interface FocusStop {
  target: string;
  outlineStyle: string;
  outlineWidth: number;
}

interface FocusWalk {
  /** Stops where the focused element itself matches `:focus`. */
  stops: FocusStop[];
  /** Tab presses that landed on a date input's own picker indicator. */
  datePickerStops: number;
  /** Stops whose `activeElement` is not focused and is not a date input. */
  unaccounted: string[];
  /** Date inputs in the document when the walk ended. */
  dateInputs: number;
  /** Whether focus wrapped back to the document before `MAX_FOCUS_STOPS`. */
  wrapped: boolean;
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
 * Press Tab until focus wraps back to the document, recording the computed
 * outline of each focused element.
 *
 * Chromium also tabs onto each date input's own picker indicator, a
 * browser-internal part that draws its own focus ring: `activeElement` is
 * then the date input but it does not match `:focus`, so the host's computed
 * outline says nothing about it. Those presses are counted, not checked; any
 * other unfocused `activeElement` is reported.
 */
async function walkFocus(page: Page): Promise<FocusWalk> {
  const walk: FocusWalk = { stops: [], datePickerStops: 0, unaccounted: [], dateInputs: 0, wrapped: false };
  for (let i = 0; i < MAX_FOCUS_STOPS; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) {
        return { kind: 'wrapped' as const };
      }
      const classes = typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).join('.')
        : '';
      const target = `${el.tagName.toLowerCase()}${classes} "${(el.textContent ?? '').trim().slice(0, 30)}"`;
      if (!el.matches(':focus')) {
        return el.matches('input[type="date"]')
          ? { kind: 'date-picker' as const }
          : { kind: 'unaccounted' as const, target };
      }
      const style = getComputedStyle(el);
      return {
        kind: 'focused' as const,
        stop: { target, outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth) },
      };
    });
    if (stop.kind === 'wrapped') {
      walk.wrapped = true;
      break;
    }
    if (stop.kind === 'date-picker') {
      walk.datePickerStops++;
    }
    else if (stop.kind === 'unaccounted') {
      walk.unaccounted.push(stop.target);
    }
    else {
      walk.stops.push(stop.stop);
    }
  }
  walk.dateInputs = await page.locator('input[type="date"]').count();
  return walk;
}

/**
 * Walk focus from wherever it sits to the end of the document and assert
 * that every stop draws a visible outline. Returns the walk.
 */
async function expectFocusOutlines(page: Page): Promise<FocusWalk> {
  const walk = await walkFocus(page);
  expect(walk.wrapped, `focus wraps within ${MAX_FOCUS_STOPS} Tab presses`).toBe(true);
  expect(walk.stops.length, 'the page has keyboard focus stops').toBeGreaterThan(0);
  expect(walk.unaccounted, 'focused elements that do not match :focus').toEqual([]);
  expect(walk.datePickerStops, 'picker indicator stops, at most one per date input')
    .toBeLessThanOrEqual(walk.dateInputs);
  const unoutlined = walk.stops.filter(s => s.outlineStyle === 'none' || !(s.outlineWidth > 0));
  expect(unoutlined, 'focus stops without an outline').toEqual([]);
  return walk;
}

/** Text must clear the WCAG AA normal-text floor against its surface. */
async function expectLegibleText(page: Page, selector: string): Promise<void> {
  await expectLegible(page, selector, 'color', MIN_NORMAL_TEXT_CONTRAST);
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

/**
 * Open the date filter on the page already loaded and switch it to custom
 * dates. Works on the site calendar and the widget, which share the filter.
 */
async function openCustomDates(page: Page): Promise<void> {
  await page.locator('.date-filter-button').click();
  await expect(page.locator('.date-dropdown')).toBeVisible({ timeout: 15000 });
  await page.locator('.date-pill.calendar-pill').click();
  await expect(page.locator('.date-input').first()).toBeVisible({ timeout: 15000 });
}

const targets = (walk: FocusWalk) => walk.stops.map(s => s.target);

for (const osScheme of ['light', 'dark'] as const) {
  test(`forced colors on a ${osScheme} OS keep focus and text visible`, async ({ browser }) => {
    const { page, cleanup } = await openForcedColors(browser, osScheme);
    try {
      await test.step('calendar page, from the document start', async () => {
        // A fresh load leaves the focus starting point at the document start.
        await page.goto(env.baseURL + '/test_calendar');
        await expect(page.locator('li.day-event-item').first()).toBeVisible({ timeout: 15000 });

        await expectLegibleText(page, '.calendar-title');
        await expectLegibleText(page, 'li.day-event-item h3');
        await expectLegibleText(page, '.date-filter-button');

        const walk = await expectFocusOutlines(page);
        expect(targets(walk).some(t => t.startsWith('input.search-input')), 'the walk crossed the search input').toBe(true);
        expect(targets(walk).some(t => t.startsWith('button.date-filter-button')), 'the walk crossed the date filter button').toBe(true);
        expect(targets(walk).some(t => t.startsWith('button.category-pill')), 'the walk crossed the category pills').toBe(true);
      });

      await test.step('calendar with the custom date filter open', async () => {
        await openCustomDates(page);

        await expectLegibleText(page, '.date-input-label');
        await expectLegibleText(page, '.date-input');
        // The custom date field's edge is a non-text graphic: the 3:1 floor.
        await expectLegible(page, '.date-input', 'borderTopColor');

        // Walk on from the date filter button: through every date mode pill,
        // both date inputs, and the rest of the page.
        await page.locator('.date-filter-button').focus();
        const walk = await expectFocusOutlines(page);
        expect(targets(walk).filter(t => t.startsWith('button.date-pill')).length, 'the walk crossed the date mode pills')
          .toBe(await page.locator('.date-dropdown button.date-pill').count());
        expect(targets(walk).filter(t => t.startsWith('input.date-input')).length, 'the walk crossed both date inputs')
          .toBeGreaterThanOrEqual(2);
      });

      await test.step('event page', async () => {
        const href = await page.locator('li.day-event-item h3 a').first().getAttribute('href');
        await page.goto(env.baseURL + href);
        await expect(page.locator('.instance-title')).toBeVisible({ timeout: 15000 });

        await expectLegibleText(page, '.instance-title');
        await expectLegibleText(page, '.back-link');

        await expectFocusOutlines(page);
      });

      await test.step('widget', async () => {
        await page.goto(env.baseURL + '/widget/test_calendar?view=list');
        await expect(page.locator('.list-view .event-title-link').first()).toBeVisible({ timeout: 20000 });

        await expectLegibleText(page, '.list-view .event-title-link');
        await expectLegibleText(page, '.category-filter-section .filter-label');
        await expectLegibleText(page, '.widget-footer a');

        const walk = await expectFocusOutlines(page);
        expect(targets(walk).some(t => t.startsWith('a.event-title-link')), 'the walk crossed the event links').toBe(true);
      });
    }
    finally {
      await cleanup();
    }
  });
}

// Chromium's light forced-colors emulation paints no picker indicator at all,
// even on an unstyled date input, so the indicator is only measurable on the
// dark (white-on-black) palette. The site and the widget share the filter.
for (const { surface, path } of [
  { surface: 'site calendar', path: '/test_calendar' },
  { surface: 'widget', path: '/widget/test_calendar?view=list' },
]) {
  test(`forced colors paint the ${surface}'s custom date picker indicator at full strength`, async ({ browser }) => {
    const { page, cleanup } = await openForcedColors(browser, 'dark');
    try {
      await page.goto(env.baseURL + path);
      await expect(page.locator('.date-filter-button')).toBeVisible({ timeout: 20000 });
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
      const fieldSurface = surfaceOf(probe.backdrop);
      expect(fieldSurface).not.toBeNull();
      const textContrast = contrastRatio(probe.color, fieldSurface!);

      // The indicator sits at the input's inline end, inside its padding.
      const indicator = { x: box!.x + box!.width - 32, y: box!.y + 4, width: 28, height: box!.height - 8 };
      await expect.poll(
        () => peakRegionContrast(page, indicator),
        { message: 'picker indicator contrast against the field', timeout: 15000, intervals: [200, 500, 1000] },
      ).toBeGreaterThanOrEqual(textContrast * 0.9);
    }
    finally {
      await cleanup();
    }
  });
}
