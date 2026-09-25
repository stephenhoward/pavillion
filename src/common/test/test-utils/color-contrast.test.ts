/**
 * Pins the colour arithmetic the e2e colour-mode assertions rest on. A bug
 * here would let those assertions pass or fail for the wrong reason, and the
 * e2e suite alone cannot tell the two apart.
 */
import { describe, it, expect } from 'vitest';
import {
  parseRgba,
  composite,
  sideOf,
  surfaceOf,
  relativeLuminance,
  contrastRatio,
} from '@/common/test-utils/color-contrast';

const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const BLACK = { r: 0, g: 0, b: 0, a: 1 };

describe('parseRgba', () => {
  it('reads rgb() as opaque', () => {
    expect(parseRgba('rgb(26, 26, 30)')).toEqual({ r: 26, g: 26, b: 30, a: 1 });
  });

  it('reads rgba() with a fractional alpha', () => {
    expect(parseRgba('rgba(255, 255, 255, 0.65)')).toEqual({ r: 255, g: 255, b: 255, a: 0.65 });
  });

  it('returns null for a colour it cannot read', () => {
    expect(parseRgba('transparent')).toBeNull();
    expect(parseRgba('#ffffff')).toBeNull();
  });
});

describe('composite', () => {
  it('blends a half-transparent colour halfway into the opaque backdrop', () => {
    expect(composite({ r: 0, g: 0, b: 0, a: 0.5 }, WHITE)).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
  });

  it('leaves the backdrop unchanged under a fully transparent colour', () => {
    expect(composite({ r: 0, g: 0, b: 0, a: 0 }, WHITE)).toEqual(WHITE);
  });

  it('replaces the backdrop with an opaque colour', () => {
    expect(composite(BLACK, WHITE)).toEqual(BLACK);
  });
});

describe('sideOf', () => {
  it('classifies exact mid-grey as dark: light needs an average channel above 128', () => {
    expect(sideOf('rgb(128, 128, 128)')).toBe('dark');
  });

  it('classifies the first step above mid-grey as light', () => {
    expect(sideOf('rgb(129, 128, 128)')).toBe('light');
  });

  it('ignores alpha, so translucent white ink is light', () => {
    expect(sideOf('rgba(255, 255, 255, 0.12)')).toBe('light');
    expect(sideOf('rgba(0, 0, 0, 0.08)')).toBe('dark');
  });

  it('returns null for a colour it cannot read', () => {
    expect(sideOf('transparent')).toBeNull();
  });
});

describe('surfaceOf', () => {
  it('composites translucent layers over the nearest opaque ancestor and ignores those beyond it', () => {
    const backdrop = ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0.5)', 'rgb(255, 255, 255)', 'rgb(0, 0, 0)'];
    expect(surfaceOf(backdrop)).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
  });

  it('returns null when no layer is opaque', () => {
    expect(surfaceOf(['rgba(0, 0, 0, 0)', 'rgba(255, 255, 255, 0.5)'])).toBeNull();
  });
});

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance(BLACK)).toBe(0);
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 10);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white, the WCAG maximum', () => {
    expect(contrastRatio('rgb(0, 0, 0)', WHITE)).toBeCloseTo(21, 10);
  });

  it('is 1 for a colour on itself', () => {
    expect(contrastRatio('rgb(255, 255, 255)', WHITE)).toBeCloseTo(1, 10);
  });

  it('gives #777 on white its published ratio of 4.48', () => {
    expect(contrastRatio('rgb(119, 119, 119)', WHITE)).toBeCloseTo(4.48, 2);
  });

  it('lands exactly on 3:1 for the grey whose luminance is 0.3 against white', () => {
    // (1 + 0.05) / (0.3 + 0.05) = 3. Invert the sRGB transfer for L = 0.3.
    const channel = 255 * (1.055 * 0.3 ** (1 / 2.4) - 0.055);
    expect(contrastRatio(`rgb(${channel}, ${channel}, ${channel})`, WHITE)).toBeCloseTo(3, 10);
  });

  it('composites a translucent foreground over the surface before measuring', () => {
    expect(contrastRatio('rgba(0, 0, 0, 0.5)', WHITE))
      .toBeCloseTo(contrastRatio('rgb(127.5, 127.5, 127.5)', WHITE), 10);
  });

  it('is symmetric in which colour is the lighter', () => {
    expect(contrastRatio('rgb(255, 255, 255)', BLACK)).toBeCloseTo(21, 10);
  });

  it('returns 0 for a foreground it cannot read', () => {
    expect(contrastRatio('transparent', WHITE)).toBe(0);
  });
});
