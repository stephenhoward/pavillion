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
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

const SOURCE_ROOT = path.join(process.cwd(), 'src');
const UI_ROOT = path.join(SOURCE_ROOT, 'common/ui');
const SERVER_ROOT = path.join(SOURCE_ROOT, 'server');

const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.vue', '.scss'];

/** App roots that src/common/ui must never import from. */
const FORBIDDEN_ROOTS = ['client', 'site', 'widget', 'server'];

/** Matches `from '…'`, `import '…'`, and `import('…')` in TS/TSX/Vue. */
const SCRIPT_SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g;

/** Matches `@use '…'`, `@forward '…'`, and `@import '…'` in Sass. */
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

/**
 * Every module specifier a file imports, whatever the syntax it uses.
 *
 * A `.vue` file is scanned with both patterns rather than one: its `<script>`
 * block imports the TS way and its `<style lang="scss">` block imports the Sass
 * way, and the style block is where this codebase does most of its `@use`. A
 * single pattern chosen by extension would read the script and go blind to the
 * style, which is the half a shared component is most likely to reach an app
 * through.
 */
function specifiers(filePath: string): string[] {
  const source = readFileSync(filePath, 'utf-8');
  const extension = path.extname(filePath);

  const patterns = extension === '.scss'
    ? [STYLE_SPECIFIER]
    : extension === '.vue'
      ? [SCRIPT_SPECIFIER, STYLE_SPECIFIER]
      : [SCRIPT_SPECIFIER];

  return patterns.flatMap(pattern => [...source.matchAll(pattern)].map(match => match[1]));
}

/**
 * The `src`-relative path a specifier points at, or null when it points
 * outside the source tree (a package, or a bare Sass builtin like `sass:color`).
 *
 * Resolving relative specifiers rather than pattern-matching `../../site`
 * catches an escape however many levels deep it is spelled.
 */
function resolveInSource(filePath: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) {
    return specifier.slice(2);
  }

  if (specifier.startsWith('.')) {
    const resolved = path.resolve(path.dirname(filePath), specifier);
    const relative = path.relative(SOURCE_ROOT, resolved);

    return relative.startsWith('..') ? null : relative;
  }

  return null;
}

/** `file → specifier` pairs, rendered so a failure names both. */
function violations(root: string, isViolation: (target: string) => boolean): string[] {
  return sourceFiles(root).flatMap(filePath => {
    const relativeFile = path.relative(SOURCE_ROOT, filePath);

    return specifiers(filePath)
      .filter(specifier => {
        const target = resolveInSource(filePath, specifier);

        return target !== null && isViolation(target);
      })
      .map(specifier => `${relativeFile} -> ${specifier}`);
  });
}

describe('src/common/ui boundary', () => {
  it('imports nothing from a single frontend app or from the server', () => {
    const forbidden = new RegExp(`^(${FORBIDDEN_ROOTS.join('|')})(/|$)`);

    expect(violations(UI_ROOT, target => forbidden.test(target))).toEqual([]);
  });

  it('is never imported by the server', () => {
    expect(violations(SERVER_ROOT, target => /^common\/ui(\/|$)/.test(target))).toEqual([]);
  });
});
