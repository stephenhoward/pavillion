/**
 * Keeps SHELL_SIDEBAR_UP_PX and the client Sass breakpoint scale from drifting
 * apart.
 *
 * Sass and TypeScript cannot share one declaration of a breakpoint, so the md
 * width is written in both. pav-media(md) compiles from the $pav-breakpoints
 * map while --pav-breakpoint-md exposes the same width at runtime; the
 * constant is pinned to both, since a media query and a script reading only
 * one of them would disagree at the boundary.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

import { SHELL_SIDEBAR_UP_PX } from '@/client/assets/breakpoints';

const VARS_PATH = path.join(process.cwd(), 'src/client/assets/style/tokens/_breakpoint-vars.scss');

/**
 * Returns the first captured pixel value of `pattern` in `source`. Throws
 * rather than returning a default, so a renamed or restructured declaration
 * fails loudly instead of silently passing the comparison.
 */
function capturePx(source: string, pattern: RegExp, description: string): number {
  const match = source.match(pattern);

  if (!match) {
    throw new Error(`No ${description} found in ${VARS_PATH}`);
  }

  return Number(match[1]);
}

describe('shell sidebar breakpoint', () => {
  const vars = readFileSync(VARS_PATH, 'utf-8');

  it('SHELL_SIDEBAR_UP_PX matches the --pav-breakpoint-md custom property', () => {
    const md = capturePx(vars, /--pav-breakpoint-md:\s*(\d+)px/, '--pav-breakpoint-md declaration');

    expect(SHELL_SIDEBAR_UP_PX).toBe(md);
  });

  it('SHELL_SIDEBAR_UP_PX matches the md entry of $pav-breakpoints, which pav-media(md) compiles from', () => {
    const md = capturePx(
      vars,
      /\$pav-breakpoints:\s*\([^)]*\bmd:\s*(\d+)px/,
      'md entry in the $pav-breakpoints map',
    );

    expect(SHELL_SIDEBAR_UP_PX).toBe(md);
  });
});
