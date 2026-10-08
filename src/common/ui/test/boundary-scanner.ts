/**
 * The import classifier behind boundary.test.ts, plus the style-text helpers
 * the token tests and the tree-wide theme guard (scripts/check-theme-tokens.ts)
 * share: the heading-scoped TOKENS.md section parser, the `.vue` style-block
 * extractors, the Sass comment stripper, the brace-matched block extractor and
 * the enclosing-selector reader.
 *
 * Kept apart from the test so every branch can be driven by an inline fixture
 * rather than only by whatever the live tree happens to contain. No function
 * here reads a file: a path is only resolved against SOURCE_ROOT (fixed from
 * the working directory at load), so a fixture may name a file that does not
 * exist.
 *
 * The text helpers live here rather than in the guard because this module's
 * tests may not import from outside `src/` (the relative-escape rule below),
 * while scripts/ is not boundary-scanned and may import from here.
 */
import path from 'path';

export const SOURCE_ROOT = path.join(process.cwd(), 'src');
export const UI_ROOT = path.join(SOURCE_ROOT, 'common/ui');
export const UI_TEST_ROOT = path.join(UI_ROOT, 'test');

/**
 * Packages a module under src/common/ui may import.
 *
 * A closed list rather than a denylist, because the breach a shared
 * presentational module is likely to suffer is not `@/site/...` — a reviewer
 * catches that by eye — but pinia, axios, or an app store reached through one
 * of them. `i18next-vue` is unused today and stays listed in advance of the
 * shared components that read the `ui` bundle; pruning it here would only make
 * this file the cause of their failure.
 */
const ALLOWED_PACKAGES = ['vue', 'vue-router', 'luxon', 'i18next', 'i18next-vue'];

/**
 * Packages this module's own tests may import on top of ALLOWED_PACKAGES.
 *
 * The subtree gets its own list rather than an exemption, so a test still can't
 * reach for pinia or an app store to stand a fixture up.
 */
const ALLOWED_TEST_PACKAGES = ['vitest', '@vue/test-utils', 'fs', 'path'];

/**
 * Matches a script-side specifier: `from`, `import`, or a dynamic `import(`.
 * Not after `@`, so a Sass `@import` in a `.vue` style block is read once, as
 * style, rather than also as a script import a Sass builtin is rejected in.
 */
const SCRIPT_SPECIFIER = /(?<!@)\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

/** Matches a Sass-side specifier: `@use`, `@forward`, or `@import`. */
const STYLE_SPECIFIER = /@(?:use|forward|import)\s+['"]([^'"]+)['"]/g;

/** Which half of a file a specifier was found in. */
type Context = 'script' | 'style';

export interface Reference {
  specifier: string;
  context: Context;
}

/**
 * Every module specifier in `source`, whatever the syntax it uses, tagged with
 * the half of the file it came from. `extension` is the file's, dot included.
 *
 * A `.vue` file is scanned with both patterns rather than one: its script block
 * imports the TS way and its Sass style block imports the Sass way, and the
 * style block is where this codebase does most of its `@use`. A single pattern
 * chosen by extension would read the script and go blind to the style, which is
 * the half a shared component is most likely to reach an app through.
 *
 * The context tag is what lets a Sass builtin be allowed where Sass runs and
 * nowhere else.
 */
export function parseReferences(source: string, extension: string): Reference[] {
  const patterns: [Context, RegExp][] = extension === '.scss'
    ? [['style', STYLE_SPECIFIER]]
    : extension === '.vue'
      ? [['script', SCRIPT_SPECIFIER], ['style', STYLE_SPECIFIER]]
      : [['script', SCRIPT_SPECIFIER]];

  return patterns.flatMap(([context, pattern]) =>
    [...source.matchAll(pattern)].map(match => ({ specifier: match[1], context })));
}

/**
 * What a specifier points at.
 *
 * A bare package specifier and a relative path that climbs out of `src/` both
 * resolve to nothing inside the source tree, but they are different claims —
 * one names a dependency, the other leaves the repo's own layout behind — and
 * each has its own rule below. Collapsing them into one "outside" answer is how
 * an escape goes silently permitted.
 */
type Target =
  | { kind: 'source', path: string }
  | { kind: 'package', name: string }
  | { kind: 'sass-builtin' }
  | { kind: 'escape' };

/** The package a specifier belongs to, ignoring any subpath. */
function packageRoot(specifier: string): string {
  const segments = specifier.split('/');

  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}

/**
 * Resolving relative specifiers rather than pattern-matching `../../site`
 * catches an escape however many levels deep it is spelled.
 */
export function classify(filePath: string, specifier: string): Target {
  if (specifier.startsWith('@/')) {
    return { kind: 'source', path: specifier.slice(2) };
  }

  if (specifier.startsWith('.')) {
    const resolved = path.resolve(path.dirname(filePath), specifier);
    const relative = path.relative(SOURCE_ROOT, resolved);

    return relative.startsWith('..')
      ? { kind: 'escape' }
      : { kind: 'source', path: relative };
  }

  if (specifier.startsWith('sass:')) {
    return { kind: 'sass-builtin' };
  }

  return { kind: 'package', name: packageRoot(specifier) };
}

/** A Markdown code-fence delimiter line. */
const FENCE_LINE = /^\s*(```|~~~)/;

/** `lines` with every fenced code block, delimiters included, removed. */
function unfenced(lines: string[]): string[] {
  let inFence = false;

  return lines.filter(line => {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      return false;
    }
    return !inFence;
  });
}

/**
 * The token names TOKENS.md records under one `## <heading>`: the backticked
 * `--pav-*` first cell of every table row between that heading and the next
 * heading of any level. A tier's table sits directly under its heading, ahead
 * of any subsection.
 *
 * Scoped by heading rather than by row shape, so a tier is read as a tier and
 * a row moved between sections changes the answer. Every way the scoping can
 * go wrong fails closed rather than open:
 *
 * - The heading absent, renamed, or demoted below `##` throws, so a renamed
 *   section does not read as an empty tier that every check passes against.
 * - The section ends at a heading of any level, so a demoted next-tier heading
 *   cuts this tier short — which the tier-coverage checks catch — instead of
 *   folding the next tier's rows into it.
 * - Fenced code is skipped, so an example in a fence can neither stand in for
 *   the heading nor add rows.
 * - A section that records no token throws, as an absent one does.
 */
export function tokenSection(docText: string, heading: string): string[] {
  const lines = unfenced(docText.split('\n'));
  const start = lines.findIndex(line => line.trim() === `## ${heading}`);
  if (start === -1) {
    throw new Error(`TOKENS.md has no "## ${heading}" section`);
  }

  const rest = lines.slice(start + 1);
  const next = rest.findIndex(line => /^#{1,6}\s/.test(line));
  const section = next === -1 ? rest : rest.slice(0, next);

  const tokens = section
    .map(line => line.match(/^\|\s*`(--pav-[a-z0-9-]+)`\s*\|/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map(match => match[1]);
  if (tokens.length === 0) {
    throw new Error(`TOKENS.md's "## ${heading}" section records no token`);
  }

  return tokens;
}

/** A `.vue` `<style>` block: the opening tag, then the block's text in group 1. */
const STYLE_BLOCK = /(<style\b[^>]*>)([\s\S]*?)<\/style>/g;

/**
 * The text of every `<style>` block in a `.vue` source, joined by newlines.
 * Script and template are dropped, so a style check never reads them.
 */
export function styleBlocks(source: string): string {
  return [...source.matchAll(STYLE_BLOCK)].map(match => match[2]).join('\n');
}

/**
 * A `.vue` source with everything outside its `<style>` blocks blanked: every
 * character but a newline becomes a space. Script, template and the style tags
 * themselves read as whitespace, while every style character keeps its offset
 * and line, so a match can be reported at its line in the file.
 */
export function styleBlocksInPlace(source: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, ' ');
  let result = '';
  let cursor = 0;
  for (const match of source.matchAll(STYLE_BLOCK)) {
    const bodyStart = match.index! + match[1].length;
    result += blank(source.slice(cursor, bodyStart)) + match[2];
    cursor = bodyStart + match[2].length;
  }
  return result + blank(source.slice(cursor));
}

/**
 * Sass source with its comments blanked: `/* *\/` and `//`-to-end-of-line
 * become spaces, newlines kept, so offsets and line numbers survive. A quoted
 * string and the inside of an unquoted `url(...)` are copied as they are, so
 * `url(http://x)` or `content: "//"` does not swallow the rest of its line.
 */
export function stripStyleComments(source: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, ' ');
  let out = '';
  let i = 0;

  /** Copies the quoted string opening at `i`, escapes included. */
  const copyString = () => {
    const quote = source[i];
    let j = i + 1;
    while (j < source.length && source[j] !== quote && source[j] !== '\n') {
      j += source[j] === '\\' ? 2 : 1;
    }
    out += source.slice(i, j + 1);
    i = j + 1;
  };

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '/' && next === '*') {
      const close = source.indexOf('*/', i + 2);
      const end = close === -1 ? source.length : close + 2;
      out += blank(source.slice(i, end));
      i = end;
    }
    else if (char === '/' && next === '/') {
      const newline = source.indexOf('\n', i);
      const end = newline === -1 ? source.length : newline;
      out += blank(source.slice(i, end));
      i = end;
    }
    else if (char === '"' || char === '\'') {
      copyString();
    }
    else if (/^url\(/i.test(source.slice(i, i + 4)) && !/[\w-]/.test(source[i - 1] ?? '')) {
      out += source.slice(i, i + 4);
      i += 4;
      while (i < source.length && source[i] !== ')') {
        if (source[i] === '"' || source[i] === '\'') {
          copyString();
        }
        else {
          out += source[i++];
        }
      }
    }
    else {
      out += char;
      i++;
    }
  }
  return out;
}

/** A brace-delimited block: its body, and the span of the whole block. */
export interface NamedBlock {
  body: string;
  start: number;
  end: number;
}

/**
 * Finds the block opened by `header` at the start of a line in `source` and
 * returns its body plus the span of the whole block. Anchoring to the line
 * start keeps a mention of the header in prose from matching. Pass source with
 * comments stripped: `#{...}` interpolations are balanced, so brace counting is
 * then enough. Throws rather than returning an empty body, so a renamed mixin
 * or branch fails loudly instead of passing vacuously. `where` names `source`
 * in that error.
 */
export function namedBlock(source: string, header: string, where: string): NamedBlock {
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

/**
 * The selector of the rule enclosing `index`: scan back to the unmatched `{`,
 * then back again to the previous `;`, `{` or `}`. Empty at the top level.
 */
export function enclosingSelector(source: string, index: number): string {
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

/** Whether a file is one of this module's own tests. */
function isModuleTest(filePath: string): boolean {
  return filePath.startsWith(UI_TEST_ROOT + path.sep);
}

/**
 * Whether a reference that leaves the source tree is one the README permits.
 *
 * A `source` target is not this check's business — the app-root assertion in
 * boundary.test.ts already judges it.
 */
export function isPermittedOutsideSource(filePath: string, reference: Reference): boolean {
  const target = classify(filePath, reference.specifier);

  switch (target.kind) {
    case 'source':
      return true;
    case 'escape':
      return false;
    case 'sass-builtin':
      return reference.context === 'style';
    case 'package':
      return ALLOWED_PACKAGES.includes(target.name)
        || (isModuleTest(filePath) && ALLOWED_TEST_PACKAGES.includes(target.name));
  }
}
