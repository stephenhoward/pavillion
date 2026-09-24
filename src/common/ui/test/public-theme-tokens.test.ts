/**
 * Keeps the `public-theme-tokens` mixin from drifting away from the `$public-*`
 * palette it bridges to runtime.
 *
 * Every `$public-<base>-light` / `$public-<base>-dark` pair in mixins.scss must
 * reach the site and widget as one `--pav-*` custom property: redeclared with
 * the dark value inside the mixin's `public-dark-mode` block, and declared
 * under the same name with the light value in its base block. A pair added to
 * the palette without a token, or a token whose light and dark halves carry
 * different names, fails here instead of silently leaving a gap in the runtime
 * set. TOKENS.md is the lookup table later migrations read, so it is held to
 * the same mapping.
 *
 * Like breakpoints.test.ts, this reads the SCSS as text rather than compiling it.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

const MIXINS_PATH = path.join(process.cwd(), 'src/common/ui/assets/mixins.scss');
const TOKENS_DOC_PATH = path.join(process.cwd(), 'src/common/ui/TOKENS.md');
const APP_STYLE_DIRS = ['src/site', 'src/widget'].map(dir => path.join(process.cwd(), dir));

type Declarations = Map<string, string>;

/**
 * Finds `<header> {` in `source` and returns its body plus the span of the
 * whole block. `#{...}` interpolations are balanced, so brace counting is
 * enough. Throws rather than returning an empty body, so a renamed mixin fails
 * loudly instead of passing vacuously.
 */
function namedBlock(source: string, header: string): { body: string; start: number; end: number } {
  const start = source.indexOf(`${header} {`);
  if (start === -1) {
    throw new Error(`No "${header} {" found in ${MIXINS_PATH}`);
  }
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (depth === 0) {
      return { body: source.slice(open + 1, i), start, end: i + 1 };
    }
  }
  throw new Error(`Unbalanced braces in "${header}" in ${MIXINS_PATH}`);
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function customProperties(block: string): Declarations {
  const declarations: Declarations = new Map();
  for (const match of stripComments(block).matchAll(/(--pav-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    declarations.set(match[1], match[2].trim());
  }
  return declarations;
}

/**
 * The selector of the rule enclosing `index`: scan back to the unmatched `{`,
 * then back again to the previous `;`, `{` or `}`.
 */
function enclosingSelector(source: string, index: number): string {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    if (source[i] === '}') depth++;
    if (source[i] === '{') {
      if (depth === 0) {
        const head = source.slice(0, i);
        const from = Math.max(head.lastIndexOf(';'), head.lastIndexOf('{'), head.lastIndexOf('}'));
        return head.slice(from + 1).trim();
      }
      depth--;
    }
  }
  return '';
}

/** Bases that have both a `$public-<base>-light` and a `$public-<base>-dark`. */
function paletteBases(source: string): string[] {
  const declared = (mode: string) => new Set(
    [...source.matchAll(new RegExp(`^\\$public-([a-z0-9-]+)-${mode}\\s*:`, 'gm'))].map(m => m[1]),
  );
  const dark = declared('dark');
  return [...declared('light')].filter(base => dark.has(base)).sort();
}

describe('public-theme-tokens', () => {
  const mixins = readFileSync(MIXINS_PATH, 'utf-8');
  const mixin = namedBlock(mixins, '@mixin public-theme-tokens');
  const dark = namedBlock(mixin.body, '@include public-dark-mode');
  const lightBlock = customProperties(mixin.body.slice(0, dark.start) + mixin.body.slice(dark.end));
  const darkBlock = customProperties(dark.body);
  const bases = paletteBases(mixins);

  /**
   * A declaration's value with one `var(--pav-*)` hop followed into the base
   * block — the theme-switched accent tokens read the fixed-mode
   * `--pav-accent-light` / `--pav-accent-dark` so the widget's runtime accent
   * override reaches them.
   */
  const resolve = (value: string): string => {
    const hop = value.match(/^var\((--pav-[a-z0-9-]+)\)$/);
    return (hop && lightBlock.get(hop[1])) ?? value;
  };

  const carriers = (block: Declarations, variable: string): string[] =>
    [...block.entries()]
      .filter(([, value]) => resolve(value).includes(`#{${variable}}`))
      .map(([name]) => name);

  /** The theme-switched token for a base, as named in the dark block. */
  const tokenFor = (base: string): string | undefined => carriers(darkBlock, `$public-${base}-dark`)[0];

  it('finds the palette pairs it guards', () => {
    expect(bases).toContain('accent');
    expect(bases).toContain('bg-primary');
    expect(bases).toContain('shadow-xl');
    // $public-font-weight-light is a weight, not half of a light/dark pair.
    expect(bases).not.toContain('font-weight');
  });

  it('emits every $public-* light/dark pair as one --pav-* property in both blocks', () => {
    const problems: string[] = [];
    for (const base of bases) {
      const inDark = carriers(darkBlock, `$public-${base}-dark`);
      if (inDark.length !== 1) {
        problems.push(`${base}: expected one dark-block property, found [${inDark.join(', ')}]`);
        continue;
      }
      if (!carriers(lightBlock, `$public-${base}-light`).includes(inDark[0])) {
        problems.push(`${base}: ${inDark[0]} is not declared with $public-${base}-light in the base block`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('keeps the four runtime-overridable accent properties', () => {
    expect(lightBlock.get('--pav-accent-light')).toBe('#{$public-accent-light}');
    expect(lightBlock.get('--pav-accent-light-hover')).toBe('#{$public-accent-hover-light}');
    expect(lightBlock.get('--pav-accent-dark')).toBe('#{$public-accent-dark}');
    expect(lightBlock.get('--pav-accent-dark-hover')).toBe('#{$public-accent-hover-dark}');
  });

  it('records every base-to-token mapping in TOKENS.md', () => {
    const doc = readFileSync(TOKENS_DOC_PATH, 'utf-8');
    const unrecorded = bases
      .map(base => ({ base, token: tokenFor(base) }))
      .filter(({ base, token }) => !new RegExp(`^\\|\\s*\`${base}\`\\s*\\|\\s*\`${token}\`\\s*\\|`, 'm').test(doc))
      .map(({ base, token }) => `${base} -> ${token}`);
    expect(unrecorded).toEqual([]);
  });

  it('is included only below the document root, where its dark branch can match', () => {
    const includeSites = APP_STYLE_DIRS
      .flatMap(dir => (readdirSync(dir, { recursive: true }) as string[]).map(file => path.join(dir, file)))
      .filter(file => /\.(scss|vue)$/.test(file))
      .flatMap((file) => {
        const source = stripComments(readFileSync(file, 'utf-8'));
        return [...source.matchAll(/@include\s+public-theme-tokens\b/g)]
          .map(match => ({ file: path.relative(process.cwd(), file), selector: enclosingSelector(source, match.index!) }));
      });

    expect(includeSites.map(site => site.file)).toEqual(expect.arrayContaining([
      path.join('src', 'site', 'assets', 'style.scss'),
      path.join('src', 'widget', 'components', 'app.vue'),
    ]));
    expect(includeSites.filter(site => /(^|[\s,>+~])(:root|html)(?![\w-])/.test(site.selector))).toEqual([]);
  });
});
