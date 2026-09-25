import { expect, Locator } from '@playwright/test';
import {
  Theme,
  sideOf,
  sideOfRgba,
  surfaceOf,
  contrastRatio,
} from '@/common/test-utils/color-contrast';

export type { Theme };

/**
 * Colour-mode assertions for the public surfaces (site and widget).
 *
 * Colours are classified rather than matched against token values: an ink
 * colour (text, border, icon mask) must sit on the opposite side of mid-grey
 * from the theme, a surface on the same side, and text must clear a 3:1
 * contrast floor against the surface it is painted on. A surface rendered in
 * the wrong theme inverts all three, so the assertions catch a theming
 * regression without coupling the suite to exact SCSS values.
 *
 * The colour arithmetic is DOM-free and unit-tested in
 * src/common/test-utils/color-contrast.ts; this file only reads computed
 * styles and polls.
 */

/** Anything that can scope a locator: a Page, a FrameLocator, a Locator. */
interface LocatorRoot {
  locator(selector: string): Locator;
}

/** Computed colours of one element plus the backgrounds of its ancestors. */
interface ColorProbe {
  color: string;
  borderTopColor: string;
  backgroundColor: string;
  /** Background colours from the element outward to `<html>`. */
  backdrop: string[];
}

/** Minimum contrast for text against its surface: the WCAG large-text floor. */
const MIN_TEXT_CONTRAST = 3;

const POLL = { timeout: 15000, intervals: [200, 500, 1000] };

export const opposite = (theme: Theme): Theme => (theme === 'light' ? 'dark' : 'light');

/** Read the computed colours of the first element matching `selector`. */
async function probeColors(root: LocatorRoot, selector: string): Promise<ColorProbe> {
  const element = root.locator(selector).first();
  await expect(element).toBeAttached({ timeout: 15000 });
  return element.evaluate((el) => {
    const style = getComputedStyle(el);
    const backdrop: string[] = [];
    for (let node: Element | null = el; node; node = node.parentElement) {
      backdrop.push(getComputedStyle(node).backgroundColor);
    }
    return {
      color: style.color,
      borderTopColor: style.borderTopColor,
      backgroundColor: style.backgroundColor,
      backdrop,
    };
  });
}

/**
 * Assert that `selector`'s text colour belongs to `theme` and is legible on
 * the opaque surface it is painted on. Polls, because a forced mode may be
 * applied after the first paint.
 */
export async function expectThemedText(root: LocatorRoot, selector: string, theme: Theme): Promise<void> {
  await expect.poll(
    async () => {
      const probe = await probeColors(root, selector);
      const surface = surfaceOf(probe.backdrop);
      return {
        inkSide: sideOf(probe.color),
        surfaceSide: surface ? sideOfRgba(surface) : null,
        legible: surface ? contrastRatio(probe.color, surface) >= MIN_TEXT_CONTRAST : false,
      };
    },
    { message: `${selector} text under ${theme}`, ...POLL },
  ).toEqual({ inkSide: opposite(theme), surfaceSide: theme, legible: true });
}

/** Assert one computed colour property of `selector` sits on `side` of mid-grey. */
export async function expectColorSide(
  root: LocatorRoot,
  selector: string,
  property: 'color' | 'borderTopColor' | 'backgroundColor',
  side: Theme,
): Promise<void> {
  await expect.poll(
    async () => sideOf((await probeColors(root, selector))[property]),
    { message: `${selector} ${property}`, ...POLL },
  ).toBe(side);
}

/** Assert the opaque surface under `selector` belongs to `theme`. */
export async function expectThemedSurface(root: LocatorRoot, selector: string, theme: Theme): Promise<void> {
  await expect.poll(
    async () => {
      const surface = surfaceOf((await probeColors(root, selector)).backdrop);
      return surface ? sideOfRgba(surface) : null;
    },
    { message: `${selector} surface under ${theme}`, ...POLL },
  ).toBe(theme);
}
