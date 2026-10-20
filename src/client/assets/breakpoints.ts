/**
 * Width breakpoints the client app must read in script rather than only in a
 * media query.
 *
 * SHELL_SIDEBAR_UP_PX mirrors the md entry of the client Sass scale
 * (`$pav-breakpoints` and `--pav-breakpoint-md` in
 * ./style/tokens/_breakpoint-vars.scss). Sass and TypeScript cannot share a
 * single declaration, so the two are kept honest by
 * test/shell-breakpoint.test.ts, which parses the Sass file and fails when they
 * disagree. Change one, change the other.
 *
 * This lives in the client rather than in src/common/ui/assets/breakpoints.ts
 * because DEC-019 keeps the client and public breakpoint scales separate.
 */

/**
 * Minimum width, in CSS pixels, at which the shell moves the main nav from the
 * bottom tab bar to the sidebar. Settings borrows the same width for its tree
 * sidebar rather than declaring a second breakpoint.
 */
export const SHELL_SIDEBAR_UP_PX = 768;
