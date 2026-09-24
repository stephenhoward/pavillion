/**
 * Enforces the src/common/ui boundary described in ../README.md.
 *
 * The shared UI module is imported by more than one frontend app, so it may
 * not reach back into any single app, and the server may not reach into it at
 * all. Both directions are structural claims that nothing else checks: a
 * violating import compiles and runs perfectly well in the app that happens to
 * own the file being reached for, and only breaks when a second app loads the
 * same component.
 *
 * Scope is the new module only. Existing widget -> site and site -> client
 * imports elsewhere in the tree are tracked debt on pv-z1in, not failures here.
 *
 * There is deliberately no "the client imports nothing from here" assertion.
 * The client is a consumer like the site and widget: a shared component reads
 * --pav-* custom properties, which every app declares, so it renders in the
 * client as it does anywhere else. What keeps that true is the styling check
 * at the bottom of this file, not an import ban.
 *
 * The scan is textual and does not strip comments, so a comment anywhere under
 * src/common/ui that spells an import with a quoted specifier is read as one.
 * Write such an example without the quotes — a comment cannot silence the
 * scanner, and a scanner that skipped comments could be talked out of a real
 * import by one.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

const SOURCE_ROOT = path.join(process.cwd(), 'src');
const UI_ROOT = path.join(SOURCE_ROOT, 'common/ui');
const UI_TEST_ROOT = path.join(UI_ROOT, 'test');
const SERVER_ROOT = path.join(SOURCE_ROOT, 'server');

const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.vue', '.scss'];

/** App roots that src/common/ui must never import from. */
const FORBIDDEN_ROOTS = ['client', 'site', 'widget', 'server'];

/**
 * Packages a module under src/common/ui may import.
 *
 * A closed list rather than a denylist, because the breach a shared
 * presentational module is likely to suffer is not `@/site/...` — a reviewer
 * catches that by eye — but pinia, axios, or an app store reached through one
 * of them. `i18next-vue` is unused today and stays listed: the `ui` i18n
 * namespace arrives in the same epic, and pruning it here would only make this
 * file the cause of that failure.
 */
const ALLOWED_PACKAGES = ['vue', 'vue-router', 'luxon', 'i18next', 'i18next-vue'];

/**
 * Packages this module's own tests may import on top of ALLOWED_PACKAGES.
 *
 * The subtree gets its own list rather than an exemption, so a test still can't
 * reach for pinia or an app store to stand a fixture up.
 */
const ALLOWED_TEST_PACKAGES = ['vitest', '@vue/test-utils', 'fs', 'path'];

/** Matches a script-side specifier: `from`, `import`, or a dynamic `import(`. */
const SCRIPT_SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g;

/** Matches a Sass-side specifier: `@use`, `@forward`, or `@import`. */
const STYLE_SPECIFIER = /@(?:use|forward|import)\s+['"]([^'"]+)['"]/g;

/** Every scannable file under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(entryPath);
    }

    return SCANNED_EXTENSIONS.includes(path.extname(entry.name)) ? [entryPath] : [];
  });
}

/** Which half of a file a specifier was found in. */
type Context = 'script' | 'style';

interface Reference {
  specifier: string;
  context: Context;
}

/**
 * Every module specifier a file imports, whatever the syntax it uses, tagged
 * with the half of the file it came from.
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
function references(filePath: string): Reference[] {
  const source = readFileSync(filePath, 'utf-8');
  const extension = path.extname(filePath);

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
function classify(filePath: string, specifier: string): Target {
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

/** `file → specifier` pairs, rendered so a failure names both. */
function violations(root: string, isViolation: (target: string) => boolean): string[] {
  return sourceFiles(root).flatMap(filePath => {
    const relativeFile = path.relative(SOURCE_ROOT, filePath);

    return references(filePath)
      .filter(({ specifier }) => {
        const target = classify(filePath, specifier);

        return target.kind === 'source' && isViolation(target.path);
      })
      .map(({ specifier }) => `${relativeFile} -> ${specifier}`);
  });
}

/** Whether a file is one of this module's own tests. */
function isModuleTest(filePath: string): boolean {
  return filePath.startsWith(UI_TEST_ROOT + path.sep);
}

/**
 * Whether a reference that leaves the source tree is one the README permits.
 *
 * A `source` target is not this assertion's business — the app-root assertion
 * above already judges it.
 */
function isPermittedOutsideSource(filePath: string, reference: Reference): boolean {
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

describe('src/common/ui boundary', () => {
  it('imports nothing from a single frontend app or from the server', () => {
    const forbidden = new RegExp(`^(${FORBIDDEN_ROOTS.join('|')})(/|$)`);

    expect(violations(UI_ROOT, target => forbidden.test(target))).toEqual([]);
  });

  it('is never imported by the server', () => {
    expect(violations(SERVER_ROOT, target => /^common\/ui(\/|$)/.test(target))).toEqual([]);
  });

  it('imports no package outside the declared allowlist', () => {
    const offenders = sourceFiles(UI_ROOT).flatMap(filePath => {
      const relativeFile = path.relative(SOURCE_ROOT, filePath);

      return references(filePath)
        .filter(reference => !isPermittedOutsideSource(filePath, reference))
        .map(({ specifier }) => `${relativeFile} -> ${specifier}`);
    });

    expect(offenders).toEqual([]);
  });
});

/** The text of every `<style>` block in a `.vue` file. */
function styleBlocks(filePath: string): string {
  const source = readFileSync(filePath, 'utf-8');

  return [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
}

/** The shared components: every `.vue` file under src/common/ui. */
function sharedComponents(): string[] {
  return sourceFiles(UI_ROOT).filter(filePath => path.extname(filePath) === '.vue');
}

/**
 * Token names in TOKENS.md's `$public-*` base → token table: rows whose first
 * cell is a bare base name, which the client table's `--pav-*` first cells are not.
 */
function recordedTokens(): Set<string> {
  const doc = readFileSync(path.join(UI_ROOT, 'TOKENS.md'), 'utf-8');

  return new Set([...doc.matchAll(/^\|\s*`[a-z0-9][a-z0-9-]*`\s*\|\s*`(--pav-[a-z0-9-]+)`\s*\|/gm)].map(match => match[1]));
}

/**
 * A shared component is compiled once and mounted by every app, so its styles
 * may only read values each app supplies at runtime. A `$public-*` variable is
 * resolved at build time to the site and widget palette and cannot follow the
 * client's theme; a `--pav-*` name missing from TOKENS.md is one some app does
 * not declare.
 */
describe('src/common/ui styling contract', () => {
  it('finds the shared components it guards', () => {
    expect(sharedComponents().length).toBeGreaterThan(0);
    expect(recordedTokens()).toContain('--pav-text-primary');
  });

  it('reads no $public-* variable in a shared component style block', () => {
    const offenders = sharedComponents()
      .filter(filePath => styleBlocks(filePath).includes('$public-'))
      .map(filePath => path.relative(SOURCE_ROOT, filePath));

    expect(offenders).toEqual([]);
  });

  it('reads only --pav-* names recorded in TOKENS.md', () => {
    const recorded = recordedTokens();
    const offenders = sharedComponents().flatMap(filePath =>
      [...styleBlocks(filePath).matchAll(/var\(\s*(--pav-[a-z0-9-]+)/g)]
        .map(match => match[1])
        .filter(name => !recorded.has(name))
        .map(name => `${path.relative(SOURCE_ROOT, filePath)} -> ${name}`));

    expect(offenders).toEqual([]);
  });
});
