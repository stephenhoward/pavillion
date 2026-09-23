/**
 * Width breakpoints for shared UI components that must branch on available
 * width in script rather than in a media query — a grid that renders a
 * different number of columns, for instance, cannot express the choice in CSS
 * alone.
 *
 * These literals mirror the `public-tablet-up` and `public-desktop-up` mixins
 * in ./mixins.scss. Sass and TypeScript cannot share a single declaration, so
 * the two are kept honest by test/breakpoints.test.ts, which parses the mixins
 * and fails when they disagree. Change one, change the other.
 *
 * Only these two named mixins are mirrored here. The older
 * `$public-mobile-breakpoint` / `$public-tablet-breakpoint` pair further down
 * mixins.scss is a separate, legacy scale and deliberately has no counterpart.
 */

/** Minimum width, in CSS pixels, at which the tablet layout applies. */
export const TABLET_UP_PX = 600;

/** Minimum width, in CSS pixels, at which the desktop layout applies. */
export const DESKTOP_UP_PX = 1024;

/**
 * The layout tier a measured width falls into.
 *
 * Components branch on the tier rather than on raw pixels so that the
 * comparison lives in one place: `narrow` below TABLET_UP_PX, `medium` from
 * there up to DESKTOP_UP_PX, `wide` at DESKTOP_UP_PX and above.
 */
export type WidthTier = 'narrow' | 'medium' | 'wide';

/**
 * Classifies a width in CSS pixels into its layout tier.
 *
 * The boundaries are inclusive at the lower end, matching `min-width` media
 * query semantics: a width of exactly TABLET_UP_PX is `medium`, not `narrow`.
 */
export function widthTier(px: number): WidthTier {
  if (px >= DESKTOP_UP_PX) {
    return 'wide';
  }
  if (px >= TABLET_UP_PX) {
    return 'medium';
  }
  return 'narrow';
}
