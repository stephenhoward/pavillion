/**
 * Keeps breakpoints.ts and mixins.scss from drifting apart.
 *
 * Sass and TypeScript cannot share one declaration of a breakpoint, so the
 * same two numbers are written twice. This test is what makes the duplication
 * safe: it parses the min-width literal out of each mixin and compares it with
 * the exported constant.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

import { TABLET_UP_PX, DESKTOP_UP_PX, widthTier } from '@/common/ui/assets/breakpoints';

const MIXINS_PATH = path.join(process.cwd(), 'src/common/ui/assets/mixins.scss');

/**
 * Reads the `min-width` pixel literal out of a named mixin. Throws rather than
 * returning a default, so a renamed or restructured mixin fails loudly instead
 * of silently passing the comparison.
 */
function mixinMinWidth(source: string, mixinName: string): number {
  const pattern = new RegExp(`@mixin\\s+${mixinName}\\s*\\{[^}]*min-width:\\s*(\\d+)px`);
  const match = source.match(pattern);

  if (!match) {
    throw new Error(`No min-width found in @mixin ${mixinName} in ${MIXINS_PATH}`);
  }

  return Number(match[1]);
}

describe('shared UI breakpoints', () => {
  const mixins = readFileSync(MIXINS_PATH, 'utf-8');

  it('TABLET_UP_PX matches the public-tablet-up mixin', () => {
    expect(TABLET_UP_PX).toBe(mixinMinWidth(mixins, 'public-tablet-up'));
  });

  it('DESKTOP_UP_PX matches the public-desktop-up mixin', () => {
    expect(DESKTOP_UP_PX).toBe(mixinMinWidth(mixins, 'public-desktop-up'));
  });

  describe('widthTier', () => {
    it('classifies widths below the tablet breakpoint as narrow', () => {
      expect(widthTier(0)).toBe('narrow');
      expect(widthTier(TABLET_UP_PX - 1)).toBe('narrow');
    });

    it('classifies the tablet breakpoint itself as medium, matching min-width', () => {
      expect(widthTier(TABLET_UP_PX)).toBe('medium');
      expect(widthTier(DESKTOP_UP_PX - 1)).toBe('medium');
    });

    it('classifies the desktop breakpoint itself as wide, matching min-width', () => {
      expect(widthTier(DESKTOP_UP_PX)).toBe('wide');
      expect(widthTier(DESKTOP_UP_PX + 500)).toBe('wide');
    });
  });
});
