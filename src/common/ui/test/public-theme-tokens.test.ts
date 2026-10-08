/**
 * Holds the site and widget token layer — the `public-theme-tokens` mixin and
 * its private `_public-theme-dark-values` helper — to the two tiers TOKENS.md
 * records, and to the client theme layer that declares the shared tier.
 *
 * - Every row of either tier is declared with a light value in the mixin's
 *   base block and a dark value in the helper, and everything the base block
 *   declares is a row in exactly one tier, bar the four fixed accent
 *   properties the widget overrides at runtime.
 * - The shared tier is declared by the client theme layer; the public-only
 *   tier is declared nowhere in the client.
 * - Each dark value is written once, in the helper, and both dark branches
 *   include it.
 * - Every `var(--pav-*)` the site, widget or shared components read is a name
 *   the token layer declares, so a typo or a client-only name fails here
 *   rather than rendering as an unset property.
 * - Until the `$public-*` colour pairs are retired, each pair still reaches
 *   runtime as one token carrying its light and dark halves.
 *
 * No colour value is asserted anywhere in this file: the tests check names and
 * structure, and the parity probe owns what the values look like.
 *
 * Like breakpoints.test.ts, this reads the SCSS as text rather than compiling it.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

import { styleBlocks, tokenSection } from './boundary-scanner';

const MIXINS_PATH = path.join(process.cwd(), 'src/common/ui/assets/mixins.scss');
const TOKENS_PATH = path.join(process.cwd(), 'src/common/ui/TOKENS.md');
const APP_STYLE_DIRS = ['src/site', 'src/widget'].map(dir => path.join(process.cwd(), dir));
const PUBLIC_STYLE_DIRS = ['src/site', 'src/widget', 'src/common/ui'].map(dir => path.join(process.cwd(), dir));
const CLIENT_DIR = path.join(process.cwd(), 'src/client');
const CLIENT_THEME_FILES = [
  'src/client/assets/style/themes/_light.scss',
  'src/client/assets/style/themes/_dark.scss',
  'src/client/assets/style/tokens/_shadows.scss',
].map(file => path.join(process.cwd(), file));

/**
 * The widget's runtime accent override surface: `widgetStore.injectAccentColor`
 * writes these inline on `.widget-root`. The base block declares their compiled
 * defaults, and they are the only base-block names in neither tier.
 */
const FIXED_ACCENT_PROPERTIES = [
  '--pav-accent-light',
  '--pav-accent-light-hover',
  '--pav-accent-dark',
  '--pav-accent-dark-hover',
];

/**
 * `var(--pav-*)` reads in site, widget and shared-component style that the
 * token layer does not declare. Only two kinds of name may go here, each with
 * a comment saying which it is and where it is written: an accent override
 * written inline from script, and a component-local custom property the same
 * component declares. A client-only name never goes here — it is the unset read
 * this check exists to catch. Promote it to a token, or keep the read only with
 * an inline `var()` fallback and a comment citing pv-ese5.
 */
const UNDECLARED_READS_ALLOWED: string[] = [];

type Declarations = Map<string, string>;

const DECLARATION = /(--pav-[a-z0-9-]+)\s*:\s*([^;]+);/g;
const DARK_HELPER_INCLUDE = /@include\s+_public-theme-dark-values\s*;/;

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Finds the block opened by `header` at the start of a line in `source` and
 * returns its body plus the span of the whole block. Anchoring to the line
 * start keeps a mention of the header in prose from matching. `#{...}`
 * interpolations are balanced, so brace counting is enough. Throws rather than
 * returning an empty body, so a renamed mixin or branch fails loudly instead of
 * passing vacuously. `where` names `source` in that error.
 */
function namedBlock(source: string, header: string, where: string): { body: string; start: number; end: number } {
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = new RegExp(`^[ \\t]*${escaped}\\s*\\{`, 'm').exec(source);
  if (!found) {
    throw new Error(`No "${header} {" found at the start of a line in ${where}`);
  }
  const start = found.index;
  const open = start + found[0].length - 1;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (depth === 0) {
      return { body: source.slice(open + 1, i), start, end: i + 1 };
    }
  }
  throw new Error(`Unbalanced braces in "${header}" in ${where}`);
}

/** Every `--pav-*` name a block declares, once per declaration. */
function declaredNames(block: string): string[] {
  return [...stripComments(block).matchAll(DECLARATION)].map(match => match[1]);
}

function customProperties(block: string): Declarations {
  const declarations: Declarations = new Map();
  for (const match of stripComments(block).matchAll(DECLARATION)) {
    declarations.set(match[1], match[2].trim());
  }
  return declarations;
}

function duplicates(names: string[]): string[] {
  return names.filter((name, index) => names.indexOf(name) !== index);
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

const relative = (file: string): string => path.relative(process.cwd(), file);

/**
 * Every `.scss` and `.vue` file under `dirs`, test directories excluded. The
 * test-directory check reads the repo-relative path, so a checkout that itself
 * sits under a directory named `test` still scans its files.
 */
function styleFiles(dirs: string[]): string[] {
  return dirs
    .flatMap(dir => (readdirSync(dir, { recursive: true }) as string[]).map(file => path.join(dir, file)))
    .filter(file => /\.(scss|vue)$/.test(file))
    .filter(file => !relative(file).split(path.sep).includes('test'));
}

/** A file's style, comments stripped: the whole of a `.scss`, the `<style>` blocks of a `.vue`. */
function styleOf(file: string): string {
  const source = readFileSync(file, 'utf-8');
  return stripComments(file.endsWith('.vue') ? styleBlocks(source) : source);
}

describe('public-theme-tokens', () => {
  const mixins = stripComments(readFileSync(MIXINS_PATH, 'utf-8'));
  const mixin = namedBlock(mixins, '@mixin public-theme-tokens', MIXINS_PATH);
  const helper = namedBlock(mixins, '@mixin _public-theme-dark-values', MIXINS_PATH);
  const osBranch = namedBlock(mixin.body, '@media (prefers-color-scheme: dark)', 'the public-theme-tokens mixin');
  const darkBranches = {
    forced: namedBlock(mixin.body, '[data-theme="dark"] &', 'the public-theme-tokens mixin'),
    os: namedBlock(osBranch.body, ':where(:root:not([data-theme="light"])) &',
      'the prefers-color-scheme branch of public-theme-tokens'),
  };
  // The dark branches declare nothing themselves (asserted below), so every
  // declaration in the mixin body belongs to its base block.
  const lightBlock = customProperties(mixin.body);
  const darkBlock = customProperties(helper.body);

  const tokensDoc = readFileSync(TOKENS_PATH, 'utf-8');
  const shared = tokenSection(tokensDoc, 'Shared tokens');
  const publicOnly = tokenSection(tokensDoc, 'Public-only tokens');

  describe('tiers', () => {
    it('reads both tiers from TOKENS.md', () => {
      expect(shared).toContain('--pav-surface-primary');
      expect(publicOnly).toContain('--pav-surface-popover');
    });

    it('keeps the tiers disjoint', () => {
      expect(shared.filter(token => publicOnly.includes(token))).toEqual([]);
    });

    it('declares every row of both tiers in the base block and in the dark helper', () => {
      const rows = [...shared, ...publicOnly];

      expect(rows.filter(token => !lightBlock.has(token))).toEqual([]);
      expect(rows.filter(token => !darkBlock.has(token))).toEqual([]);
    });

    it('records everything the base block declares in exactly one tier, bar the fixed accent properties', () => {
      const tierCount = (token: string) => [shared, publicOnly].filter(tier => tier.includes(token)).length;
      const unrecorded = [...lightBlock.keys()]
        .filter(token => !FIXED_ACCENT_PROPERTIES.includes(token))
        .filter(token => tierCount(token) !== 1);

      expect(unrecorded).toEqual([]);
      expect(FIXED_ACCENT_PROPERTIES.filter(token => !lightBlock.has(token))).toEqual([]);
      expect(FIXED_ACCENT_PROPERTIES.filter(token => tierCount(token) > 0)).toEqual([]);
    });

    it('declares nothing in the dark helper that the base block does not', () => {
      expect([...darkBlock.keys()].filter(token => !lightBlock.has(token))).toEqual([]);
    });

    /**
     * A shared component may read any shared-tier token, so the client — which
     * declares its tokens natively rather than through this mixin — has to
     * declare every one of them, or the component renders unstyled there.
     */
    it('has every shared token declared by the client theme layer', () => {
      const clientDeclared = new Set(CLIENT_THEME_FILES.flatMap(file =>
        declaredNames(readFileSync(file, 'utf-8'))));

      expect(shared.filter(token => !clientDeclared.has(token))).toEqual([]);
    });

    it('has no public-only token declared anywhere in the client style tree', () => {
      const clientFiles = styleFiles([CLIENT_DIR]);
      expect(clientFiles.map(relative)).toContain(relative(CLIENT_THEME_FILES[0]));

      const clashes = clientFiles.flatMap(file =>
        declaredNames(styleOf(file))
          .filter(token => publicOnly.includes(token))
          .map(token => `${relative(file)}: ${token}`));

      expect(clashes).toEqual([]);
    });
  });

  describe('dark values', () => {
    it('includes the dark helper in both dark branches, which declare nothing of their own', () => {
      for (const branch of Object.values(darkBranches)) {
        expect(branch.body).toMatch(DARK_HELPER_INCLUDE);
        expect(declaredNames(branch.body)).toEqual([]);
      }
    });

    it('writes each token once in the base block and once in the dark helper', () => {
      expect(duplicates(declaredNames(mixin.body))).toEqual([]);
      expect(duplicates(declaredNames(helper.body))).toEqual([]);
    });

    it('switches the accent through the fixed accent properties', () => {
      expect(lightBlock.get('--pav-accent')).toBe('var(--pav-accent-light)');
      expect(lightBlock.get('--pav-accent-hover')).toBe('var(--pav-accent-light-hover)');
      expect(darkBlock.get('--pav-accent')).toBe('var(--pav-accent-dark)');
      expect(darkBlock.get('--pav-accent-hover')).toBe('var(--pav-accent-dark-hover)');
      expect(FIXED_ACCENT_PROPERTIES.filter(token => darkBlock.has(token))).toEqual([]);
    });
  });

  /**
   * Retired with the `$public-*` colour pairs: every `$public-<base>-light` /
   * `-dark` pair must reach runtime as one `--pav-*` token, light half in the
   * base block and dark half in the helper.
   */
  describe('$public-* pairs', () => {
    const bases = paletteBases(mixins);

    /**
     * A declaration's value with one `var(--pav-*)` hop followed into the base
     * block — the theme-switched accent tokens read the fixed accent
     * properties so the widget's runtime override reaches them.
     */
    const resolve = (value: string): string => {
      const hop = value.match(/^var\((--pav-[a-z0-9-]+)\)$/);
      return (hop && lightBlock.get(hop[1])) ?? value;
    };

    const carriers = (block: Declarations, variable: string): string[] =>
      [...block.entries()]
        .filter(([, value]) => resolve(value).includes(`#{${variable}}`))
        .map(([name]) => name);

    it('finds the palette pairs it guards', () => {
      expect(bases).toContain('accent');
      expect(bases).toContain('bg-primary');
      expect(bases).toContain('shadow-xl');
      // $public-font-weight-light is a weight, not half of a light/dark pair.
      expect(bases).not.toContain('font-weight');
    });

    it('emits every pair as one --pav-* property in the base block and the dark helper', () => {
      const problems: string[] = [];
      for (const base of bases) {
        const inDark = carriers(darkBlock, `$public-${base}-dark`);
        if (inDark.length !== 1) {
          problems.push(`${base}: expected one dark-helper property, found [${inDark.join(', ')}]`);
          continue;
        }
        if (!carriers(lightBlock, `$public-${base}-light`).includes(inDark[0])) {
          problems.push(`${base}: ${inDark[0]} is not declared with $public-${base}-light in the base block`);
        }
      }
      expect(problems).toEqual([]);
    });
  });

  /**
   * The single-sourcing half the blocks above cannot see: a dark value written
   * in a component, or in another mixin, would override the token layer from
   * outside it.
   */
  it('declares no --pav-* property in site, widget or shared style outside the token layer', () => {
    // Cut the two token-layer mixins out of mixins.scss, last span first, so
    // removing one does not shift the offsets of the other.
    const tokenLayerSpans = [mixin, helper].sort((a, b) => b.start - a.start);
    const outside = styleFiles(PUBLIC_STYLE_DIRS).flatMap((file) => {
      const style = file === MIXINS_PATH
        ? tokenLayerSpans.reduce((text, span) => text.slice(0, span.start) + text.slice(span.end), mixins)
        : styleOf(file);
      return declaredNames(style).map(token => `${relative(file)}: ${token}`);
    });

    expect(outside).toEqual([]);
  });

  it('declares every var(--pav-*) that site, widget and shared style read', () => {
    const declared = new Set([...lightBlock.keys(), ...UNDECLARED_READS_ALLOWED]);
    const reads = styleFiles(PUBLIC_STYLE_DIRS).flatMap(file =>
      [...styleOf(file).matchAll(/var\(\s*(--pav-[^\s,)]*)/g)].map(match => ({ file, token: match[1] })));

    expect(reads.length).toBeGreaterThan(0);
    expect(reads.filter(read => !declared.has(read.token)).map(read => `${relative(read.file)}: ${read.token}`))
      .toEqual([]);
  });

  it('is included only below the document root, where its dark branch can match', () => {
    const includeSites = styleFiles(APP_STYLE_DIRS).flatMap((file) => {
      const source = stripComments(readFileSync(file, 'utf-8'));
      return [...source.matchAll(/@include\s+public-theme-tokens\b/g)]
        .map(match => ({ file: relative(file), selector: enclosingSelector(source, match.index!) }));
    });

    expect(includeSites.map(site => site.file)).toEqual(expect.arrayContaining([
      path.join('src', 'site', 'assets', 'style.scss'),
      path.join('src', 'widget', 'components', 'app.vue'),
    ]));
    expect(includeSites.filter(site => /(^|[\s,>+~])(:root|html)(?![\w-])/.test(site.selector))).toEqual([]);
  });
});
