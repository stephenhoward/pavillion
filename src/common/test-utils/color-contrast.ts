/**
 * DOM-free colour arithmetic behind the e2e colour-mode assertions
 * (`tests/e2e/helpers/color-mode.ts`). It lives here rather than beside the
 * e2e helper so the unit run, which excludes `tests/e2e/**`, can test it.
 *
 * Input colours are the `rgb()` / `rgba()` strings `getComputedStyle`
 * returns.
 */

export type Theme = 'light' | 'dark';

export type Rgba = { r: number; g: number; b: number; a: number };

/** Parse a computed `rgb()`/`rgba()` string. Null for anything else. */
export function parseRgba(color: string): Rgba | null {
  const match = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (!match) return null;
  return {
    r: parseFloat(match[1]),
    g: parseFloat(match[2]),
    b: parseFloat(match[3]),
    a: match[4] === undefined ? 1 : parseFloat(match[4]),
  };
}

/** Paint `top` over an opaque `bottom`. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  return {
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  };
}

/**
 * Which side of mid-grey a colour's channels sit on, ignoring alpha: the
 * average channel must exceed 128 to count as light. The public palette
 * builds ink from black or white at partial alpha, so the channels alone say
 * which theme an ink colour belongs to.
 */
export function sideOfRgba({ r, g, b }: Rgba): Theme {
  return (r + g + b) / 3 > 128 ? 'light' : 'dark';
}

/** `sideOfRgba` for a colour string. Null when the string does not parse. */
export function sideOf(color: string): Theme | null {
  const rgba = parseRgba(color);
  return rgba ? sideOfRgba(rgba) : null;
}

/**
 * The opaque colour an element is painted on, given its own and its
 * ancestors' background colours from the element outward: layers are
 * composited from the nearest opaque one inward. Null when none is opaque.
 */
export function surfaceOf(backdrop: string[]): Rgba | null {
  const layers = backdrop.map(parseRgba).filter((c): c is Rgba => c !== null && c.a > 0);
  const opaqueIndex = layers.findIndex(c => c.a >= 0.999);
  if (opaqueIndex === -1) return null;
  let result = layers[opaqueIndex];
  for (let i = opaqueIndex - 1; i >= 0; i--) {
    result = composite(layers[i], result);
  }
  return result;
}

/** WCAG 2.x relative luminance of an opaque colour. */
export function relativeLuminance({ r, g, b }: Rgba): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG contrast ratio of `foreground` (composited over `surface` if it is
 * translucent) against the opaque `surface`. 0 when `foreground` does not
 * parse.
 */
export function contrastRatio(foreground: string, surface: Rgba): number {
  const fg = parseRgba(foreground);
  if (!fg) return 0;
  const ink = relativeLuminance(composite(fg, surface));
  const paper = relativeLuminance(surface);
  return (Math.max(ink, paper) + 0.05) / (Math.min(ink, paper) + 0.05);
}
