/**
 * The import classifier behind boundary.test.ts.
 *
 * Kept apart from the test so every branch can be driven by an inline fixture
 * rather than only by whatever the live tree happens to contain. No function
 * here reads a file: a path is only resolved against SOURCE_ROOT (fixed from
 * the working directory at load), so a fixture may name a file that does not
 * exist. It backs that one guard and nothing else, which is why it lives beside
 * the test rather than under scripts/ as a CLI.
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
