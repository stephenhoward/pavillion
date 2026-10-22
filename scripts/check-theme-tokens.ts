/**
 * check-theme-tokens.ts — CI guard that keeps site, widget and shared-UI colour
 * on the runtime `--pav-*` token layer.
 *
 * The public site, the widget and src/common/ui read every theme-varying value
 * from `--pav-*` custom properties. One mixin pair declares them all:
 * `public-theme-tokens` (light values, plus the two dark branches) and its
 * private `_public-theme-dark-values` helper (the dark values), both in
 * src/common/ui/assets/mixins.scss. Each app includes the mixin once, on its
 * root element. This script fails CI when a change reintroduces any of the
 * patterns that layer replaced:
 *
 *   Rule 1, compile-time colour. A `$public-*` Sass variable, declared or read,
 *     whose family is not in the closed non-colour allowlist
 *     (NON_COLOUR_FAMILIES). A compile-time value cannot follow the theme, so a
 *     colour one is a value that stays light in dark mode. Families are matched
 *     at a `-` boundary (`space` admits `$public-space-md`, not
 *     `$public-spacewalk`), and `_` is read as `-`, as Sass does.
 *   Rule 2, one dark declaration site. Outside the bodies of the two
 *     token-layer mixins in mixins.scss, none of: `prefers-color-scheme` (dark
 *     or light, in any media query), a `[data-theme...]` attribute selector,
 *     `@include ...public-dark-mode`, `@include _public-theme-dark-values`, a
 *     `color-scheme` declaration, `light-dark(`, or the retired
 *     `.widget-theme-light` / `.widget-theme-dark` classes as whole class
 *     tokens. No other dark class exists in the tree, so none is banned
 *     speculatively.
 *   Rule 3, token-layer include sites. `@include ...public-theme-tokens` only
 *     directly inside a top-level `#app` rule in src/site/assets/style.scss
 *     and a top-level `.widget-root` rule in src/widget/components/app.vue
 *     (`.x { #app { ... } }` is not the root). A second include on another
 *     selector in the same file re-declares the tokens below the root and
 *     shadows a runtime accent override written on the root (pv-nskn).
 *   Rule 4, token prefix spelling. A custom property spelled `--Pav-`,
 *     `--PAV-` or `--pav_` names nothing the token layer declares; custom
 *     property names are case-sensitive, so it is an unset read or a dead
 *     declaration. public-theme-tokens.test.ts catches a typo after `--pav-`;
 *     this catches one in the prefix itself.
 *   Rule 5, raw colour literals (warn-only). A hex colour, an rgb()/rgba()/
 *     hsl()/hsla()/hwb()/lab()/lch()/oklab()/oklch() call, or a CSS named
 *     colour in a declaration value or an `@include` argument, outside the
 *     two token-layer mixin bodies. A component-local `$ink: #fff;` is
 *     reported at its declaration. Such a literal renders the same in both
 *     themes, so it is never the light-value-in-dark-mode bug Rules 1-2 stop,
 *     but it bypasses the token layer. Reported as a warning on every hit, with
 *     no baseline: the existing hits are few, owned by their own beads
 *     (white-on-accent ink until the on-accent token exists, the report
 *     dialog backdrop, the image vignette bases), and shrink as those land.
 *     Warnings never change the exit code. Not reported: selectors (an id
 *     spelled in hex digits, a class named for a colour), `#{}` interpolation,
 *     strings and `url()` contents, `transparent` / `currentColor`, and
 *     `mask` / `-webkit-mask*` values, whose colour is an alpha channel rather
 *     than paint.
 *
 * Design (see bead pv-l3my.7, DESIGN §4):
 *   - Text scan, not a Sass compile: the rules are about what the source says,
 *     and a scan is fast and needs no toolchain beyond tsx.
 *   - A pure `detectSource(code, fileName)` split from `detect`,
 *     `collectThemeFiles` and a returnable `main()`, so both the rules and the
 *     CLI exit code are unit-tested (scripts/test/check-theme-tokens.test.ts).
 *   - Comments are stripped first (`//` inside `url(...)` and strings kept), so
 *     a comment never triggers a rule and never hides code after it.
 *   - No suppression comment. The only exemptions are structural, and each is
 *     keyed on a path suffix AND a name, so neither copying the mixin into
 *     another file nor adding a second mixin beside it inherits one: the
 *     token-layer mixin bodies for Rule 2, and the two named include sites for
 *     Rule 3.
 *   - Fail closed: if either token-layer mixin cannot be found in mixins.scss,
 *     or its braces do not balance, nothing in that file is exempt from
 *     Rule 2, and the file carries a violation saying so.
 *
 * Scope: every `.scss` file, and the `<style>` blocks of every `.vue` file,
 * under src/site, src/widget and src/common/ui, excluding `test` directories
 * (whose fixtures spell violations on purpose). A `.vue` file's script and
 * template are never scanned: the widget store sets `data-theme` from script,
 * and that is not a style rule. src/client has its own theme layer and is out
 * of scope.
 *
 * Known limitations (accepted, documented):
 *   - Rule 1 judges a variable by its name, not its value: a colour stored in
 *     a `$public-space-*` variable passes. Review catches that; a name that
 *     says what it holds is the contract.
 *   - Rule 3 reads the enclosing selector textually. A selector built with
 *     `#{...}` interpolation, or an include reached through another mixin, is
 *     not resolved; a top-level selector list (`#app, .x`) is not a named
 *     site and fails.
 *   - Rule 5 reads value context textually: a literal reached through a Sass
 *     function argument in a selector, or a colour held in a string (an SVG
 *     data URI's fill), is not reported.
 *
 * Overlap with src/common/ui/test/boundary.test.ts, on purpose: that test
 * holds shared components to a tighter, module-specific contract (no
 * `$public-*` of any family, only shared-tier token names, layout-only mixins,
 * no theme selector) and runs under `npm test`. This guard is canonical
 * tree-wide; where both fire, both are right.
 *
 * Usage:
 *   npx tsx scripts/check-theme-tokens.ts [root ...]
 *   # defaults to src/site src/widget src/common/ui
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  enclosingSelector,
  namedBlock,
  stripStyleComments,
  styleBlocksInPlace,
  type NamedBlock,
} from '../src/common/ui/test/boundary-scanner.js';

export interface Violation {
  file: string;
  line: number;
  message: string;
}

/**
 * The `$public-*` families that hold no colour: spacing, type, radius, motion
 * and breakpoints. A closed list — a new family is colour until it is added
 * here with a reason. `font` covers `font-family`, `font-size-*` and
 * `font-weight-*`.
 */
export const NON_COLOUR_FAMILIES = [
  'space',
  'font',
  'line-height',
  'letter-spacing',
  'radius',
  'duration',
  'ease',
  'transition',
  'mobile-breakpoint',
  'tablet-breakpoint',
] as const;

const NON_COLOUR_VARIABLE = new RegExp(`^\\$public-(?:${NON_COLOUR_FAMILIES.join('|')})(?:-|$)`);

/** Whether a `$public-*` variable name belongs to a non-colour family. */
export function isNonColourVariable(name: string): boolean {
  return NON_COLOUR_VARIABLE.test(name.replace(/_/g, '-'));
}

export const DEFAULT_ROOTS = ['src/site', 'src/widget', 'src/common/ui'];

const MIXINS_FILE = 'src/common/ui/assets/mixins.scss';
const TOKEN_LAYER_MIXINS = ['public-theme-tokens', '_public-theme-dark-values'];

/** Where the token layer may be included: a path suffix and the enclosing selector. */
const INCLUDE_SITES = [
  { file: 'src/site/assets/style.scss', selector: '#app' },
  { file: 'src/widget/components/app.vue', selector: '.widget-root' },
];

const SITE_LIST = INCLUDE_SITES.map(site => `${site.selector} in ${site.file}`).join(', ');

const DARK_SITE = `dark values are declared only in the public-theme-tokens / _public-theme-dark-values mixins in ${MIXINS_FILE}; read a --pav-* token instead`;

/** An `@include` of mixin `name`, bare or through a module namespace. */
function includeOf(name: string): RegExp {
  return new RegExp(`@include\\s+(?:[\\w-]+\\.)?${name}(?![\\w-])`, 'g');
}

/** Rule 2's patterns, each with the name it is reported under. */
const DARK_PATTERNS: { pattern: RegExp; what: string }[] = [
  { pattern: /prefers-color-scheme/g, what: 'prefers-color-scheme query' },
  { pattern: /\[\s*data-theme\b/g, what: 'data-theme attribute selector' },
  { pattern: includeOf('public-dark-mode'), what: '@include public-dark-mode' },
  { pattern: includeOf('_public-theme-dark-values'), what: '@include _public-theme-dark-values' },
  { pattern: /(?<![\w-])color-scheme\s*:/g, what: 'color-scheme declaration' },
  { pattern: /(?<![\w-])light-dark\s*\(/g, what: 'light-dark()' },
  { pattern: /\.widget-theme-(?:light|dark)(?![\w-])/g, what: 'retired .widget-theme-light/-dark class' },
];

/**
 * The CSS named colours, lower-cased. `transparent` and `currentcolor` are
 * left out: neither is a single-theme value.
 */
const NAMED_COLOURS = new Set([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black',
  'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse',
  'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan',
  'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta',
  'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink',
  'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen',
  'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow',
  'grey', 'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender',
  'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan',
  'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon',
  'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue',
  'lightyellow', 'lime', 'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine',
  'mediumblue', 'mediumorchid', 'mediumpurple', 'mediumseagreen', 'mediumslateblue',
  'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue', 'mintcream',
  'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
  'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred',
  'papayawhip', 'peachpuff', 'peru', 'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple',
  'red', 'rosybrown', 'royalblue', 'saddlebrown', 'salmon', 'sandybrown', 'seagreen',
  'seashell', 'sienna', 'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow',
  'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet', 'wheat',
  'white', 'whitesmoke', 'yellow', 'yellowgreen',
]);

/** Rule 5's candidates: a hex colour, a colour function, or a bare word checked against NAMED_COLOURS. */
const COLOUR_LITERAL = /(?<![\w&-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])|(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\s*\(|(?<![\w$@.#%&-])[a-z]+(?![\w(-])/gi;

/** A `mask` or `-webkit-mask*` property, whose colour is an alpha channel, not paint. */
const MASK_PROPERTY = /^(?:-webkit-)?mask(?:-|$)/i;

const PUBLIC_VARIABLE = /\$public[-_][\w-]*/g;
const TOKEN_LAYER_INCLUDE = includeOf('public-theme-tokens');
const MISSPELT_PREFIX = /(?<![\w-])--pav[-_]/gi;

/** Whether `fileName`, normalised to `/`, ends with the repo-relative `suffix`. */
function hasPathSuffix(fileName: string, suffix: string): boolean {
  const normalised = fileName.split(path.sep).join('/');
  return normalised === suffix || normalised.endsWith(`/${suffix}`);
}

/** How many blocks enclose `index`: braces opened before it and not yet closed. */
function depthAt(text: string, index: number): number {
  let depth = 0;
  for (let i = 0; i < index; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}') depth--;
  }
  return depth;
}

/** 1-indexed line of `index` in `text`. */
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

/**
 * The spans of mixins.scss exempt from Rule 2: the whole of each token-layer
 * mixin. Null when either cannot be found or does not balance — then nothing
 * is exempt.
 */
function tokenLayerSpans(style: string, fileName: string): NamedBlock[] | null {
  try {
    return TOKEN_LAYER_MIXINS.map(name => namedBlock(style, `@mixin ${name}`, fileName));
  }
  catch {
    return null;
  }
}

/**
 * Scan one file's source and return its violations. `fileName` selects `.vue`
 * style-block extraction versus `.scss`, and carries the path the exemptions
 * key on. Exported so the rules can be unit-tested with inline fixtures.
 */
export function detectSource(code: string, fileName: string): Violation[] {
  if (!fileName.endsWith('.vue') && !fileName.endsWith('.scss')) {
    return [];
  }
  const style = stripStyleComments(fileName.endsWith('.vue') ? styleBlocksInPlace(code) : code);
  const violations: Violation[] = [];
  const report = (index: number, message: string) =>
    violations.push({ file: fileName, line: lineAt(style, index), message });

  // Rule 1
  for (const match of style.matchAll(PUBLIC_VARIABLE)) {
    if (!isNonColourVariable(match[0])) {
      report(match.index!, `Rule 1: ${match[0]} is not a non-colour $public-* family (${NON_COLOUR_FAMILIES.join(', ')}); colour must follow the theme at runtime, so read a --pav-* token instead`);
    }
  }

  // Rule 2
  let exempt: NamedBlock[] = [];
  if (hasPathSuffix(fileName, MIXINS_FILE)) {
    const spans = tokenLayerSpans(style, fileName);
    if (spans) {
      exempt = spans;
    }
    else {
      report(0, `Rule 2: cannot find balanced @mixin ${TOKEN_LAYER_MIXINS.join(' and @mixin ')} in ${MIXINS_FILE}, so nothing in it is exempt`);
    }
  }
  const isExempt = (index: number) => exempt.some(span => index >= span.start && index < span.end);
  for (const { pattern, what } of DARK_PATTERNS) {
    for (const match of style.matchAll(pattern)) {
      if (!isExempt(match.index!)) {
        report(match.index!, `Rule 2: ${what} outside the token layer; ${DARK_SITE}`);
      }
    }
  }

  // Rule 3
  for (const match of style.matchAll(TOKEN_LAYER_INCLUDE)) {
    const selector = enclosingSelector(style, match.index!);
    const atRoot = depthAt(style, match.index!) === 1;
    const allowed = atRoot
      && INCLUDE_SITES.some(site => hasPathSuffix(fileName, site.file) && selector === site.selector);
    if (!allowed) {
      report(match.index!, `Rule 3: @include public-theme-tokens on "${selector || '(top level)'}" is not a named include site; the token layer is included only on ${SITE_LIST}`);
    }
  }

  // Rule 4
  for (const match of style.matchAll(MISSPELT_PREFIX)) {
    if (match[0] !== '--pav-') {
      report(match.index!, `Rule 4: custom property prefix "${match[0]}" is misspelt; token names start with "--pav-" (custom property names are case-sensitive)`);
    }
  }

  return violations.sort((a, b) => a.line - b.line);
}

/**
 * `style` with the contents of every string and `url(...)` blanked, and each
 * `#{...}` interpolation's braces turned to parentheses, offsets kept. Rule 5
 * then reads `{`, `}` and `;` as statement boundaries only.
 */
function literalScanText(style: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, ' ');
  return style
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, match => match[0] + blank(match.slice(1, -1)) + match[0])
    .replace(/(url\()([^)]*)\)/gi, (_m, open: string, body: string) => `${open}${blank(body)})`)
    .replace(/#\{([^{}]*)\}/g, (_m, body: string) => `#(${body})`);
}

/**
 * Whether `index` sits in a declaration value or an `@include` argument, and
 * not in a mask value: the statement around it ends at `;` or `}` rather than
 * opening a block, and the match follows its `:` (or the statement is an
 * `@include`).
 */
function inPaintValue(text: string, index: number): boolean {
  let start = index;
  while (start > 0 && !'{};'.includes(text[start - 1])) start--;
  let end = index;
  while (end < text.length && !'{};'.includes(text[end])) end++;
  if (text[end] === '{') {
    return false;
  }
  const statement = text.slice(start, index).trimStart();
  if (/^@include\b/.test(statement)) {
    return true;
  }
  const colon = statement.indexOf(':');
  return colon !== -1 && !MASK_PROPERTY.test(statement.slice(0, colon).trim());
}

/**
 * Rule 5, warn-only: the raw colour literals in one file's source, outside the
 * token-layer mixin bodies in mixins.scss. Separate from `detectSource` so a
 * warning can never become a violation; `main` prints both but exits on
 * violations alone.
 */
export function detectLiteralSource(code: string, fileName: string): Violation[] {
  if (!fileName.endsWith('.vue') && !fileName.endsWith('.scss')) {
    return [];
  }
  const style = stripStyleComments(fileName.endsWith('.vue') ? styleBlocksInPlace(code) : code);
  const text = literalScanText(style);
  const exempt = hasPathSuffix(fileName, MIXINS_FILE) ? tokenLayerSpans(style, fileName) ?? [] : [];
  const warnings: Violation[] = [];

  for (const match of text.matchAll(COLOUR_LITERAL)) {
    const literal = match[0].replace(/\s+\($/, '(');
    const isWord = /^[a-z]+$/i.test(literal);
    if (isWord && !NAMED_COLOURS.has(literal.toLowerCase())) continue;
    if (exempt.some(span => match.index! >= span.start && match.index! < span.end)) continue;
    if (!inPaintValue(text, match.index!)) continue;
    warnings.push({
      file: fileName,
      line: lineAt(text, match.index!),
      message: `Rule 5 (warn-only): raw colour literal ${literal} outside the token layer, the same in both themes; read a --pav-* token instead`,
    });
  }
  return warnings;
}

/** Read each file path and collect its Rule 5 warnings. */
export function detectLiterals(filePaths: string[]): Violation[] {
  return filePaths.flatMap(filePath => detectLiteralSource(fs.readFileSync(filePath, 'utf8'), filePath));
}

/** Read and scan each file path. */
export function detect(filePaths: string[]): Violation[] {
  return filePaths.flatMap(filePath => detectSource(fs.readFileSync(filePath, 'utf8'), filePath));
}

/**
 * Recursively collect `.vue` and `.scss` files under each root, skipping
 * `test` and `node_modules` directories (see the scope note at the top).
 */
export function collectThemeFiles(roots: string[]): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'test' && entry.name !== 'node_modules') {
          walk(full);
        }
      }
      else if (entry.isFile() && /\.(vue|scss)$/.test(entry.name)) {
        files.push(full);
      }
    }
  };
  roots.forEach(walk);
  return files;
}

/**
 * CLI entry as a pure function returning the process exit code (1 on any
 * violation, else 0; Rule 5 warnings are printed but never change it). Roots
 * default to DEFAULT_ROOTS.
 */
export function main(argv: string[] = process.argv.slice(2)): number {
  const roots = (argv.length > 0 ? argv : DEFAULT_ROOTS).map(root => path.resolve(root));
  const files = collectThemeFiles(roots);
  const violations = detect(files);
  const warnings = detectLiterals(files);

  for (const w of warnings) {
    const rel = path.relative(process.cwd(), w.file);
    process.stderr.write(`${rel}:${w.line} — ${w.message}\n`);
  }
  if (warnings.length > 0) {
    process.stderr.write(`check-theme-tokens: ${warnings.length} raw colour literal warning(s) (warn-only, exit code unaffected).\n\n`);
  }

  for (const v of violations) {
    const rel = path.relative(process.cwd(), v.file);
    process.stderr.write(`${rel}:${v.line} — ${v.message}\n`);
  }

  if (violations.length > 0) {
    process.stderr.write(`\ncheck-theme-tokens: ${violations.length} violation(s) found.\n`);
    return 1;
  }
  process.stdout.write(`check-theme-tokens: no theme-token violations found in ${files.length} file(s).\n`);
  return 0;
}

// Run only when invoked directly (not when imported by the test).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main());
}
