/**
 * Every package the production server loads must be a runtime dependency.
 *
 * The production image installs with `npm ci --omit=dev` and runs `src/` and
 * `migrations/` directly through tsx, so a package that sits under
 * devDependencies is absent at runtime unless something else happens to pull
 * it in transitively. That failure compiles, passes every test (the dev tree
 * is installed there) and only shows when the transitive holder drops it.
 *
 * The scan is textual and does not strip comments, so a comment under a
 * scanned root that spells an import with a quoted specifier is read as one.
 * Write such an example without the quotes.
 *
 * Exempt: relative and `@/` specifiers, Node builtins (with or without the
 * `node:` prefix), statement-level `import type` / `export type`, `*.test.ts`
 * files, and anything under a `test/` or `test-utils/` directory. Inline
 * `{ type X }` imports are treated as value imports.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { builtinModules } from 'module';
import path from 'path';

const REPO_ROOT = process.cwd();
const SCAN_ROOTS = ['src/server', 'src/common', 'migrations'];
const SCANNED_EXTENSIONS = new Set(['.ts', '.js']);
const EXEMPT_DIRECTORIES = new Set(['test', 'test-utils']);
const BUILTINS = new Set(builtinModules);

/**
 * `import … from` / `export … from`, anchored to the start of a line so a
 * word such as `'ics-import'` inside a string is never read as a keyword.
 * The clause between the keyword and `from` may span lines but never contains
 * a quote, `;`, `=` or parenthesis, so a match cannot run on from an
 * unrelated earlier statement.
 */
const FROM_SPECIFIER = /^\s*(import|export)\s+(type\s+)?[^'";=()]*?\bfrom\s*['"]([^'"]+)['"]/gm;

/** Side-effect `import '…'`, anchored to the start of a line. */
const SIDE_EFFECT_SPECIFIER = /^\s*import\s*['"]([^'"]+)['"]/gm;

/**
 * Dynamic `import('…')` and `require('…')`, not when the keyword is the tail
 * of an identifier, property or hyphenated string.
 */
const CALL_SPECIFIER = /(?<![\w$.'"-])(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Every specifier in `source` that the runtime resolves, `import type` and
 * `export type` statements excluded because they are erased before execution.
 */
function bareSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(FROM_SPECIFIER)) {
    if (!match[2]) {
      specifiers.push(match[3]);
    }
  }
  for (const match of source.matchAll(SIDE_EFFECT_SPECIFIER)) {
    specifiers.push(match[1]);
  }
  for (const match of source.matchAll(CALL_SPECIFIER)) {
    specifiers.push(match[1]);
  }
  return specifiers.filter((specifier) => !isExemptSpecifier(specifier));
}

/** The installable package a specifier resolves through. */
function packageName(specifier: string): string {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}

/** True when a specifier never resolves through node_modules. */
function isExemptSpecifier(specifier: string): boolean {
  if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('@/')) {
    return true;
  }
  if (specifier.startsWith('node:')) {
    return true;
  }
  return BUILTINS.has(packageName(specifier));
}

/** True when a repo-relative file path is never executed in production. */
function isExemptFile(relativePath: string): boolean {
  if (relativePath.endsWith('.test.ts')) {
    return true;
  }
  return relativePath.split(/[\\/]/).some((segment) => EXEMPT_DIRECTORIES.has(segment));
}

function scannedFiles(): string[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    for (const entry of readdirSync(path.join(REPO_ROOT, root), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !SCANNED_EXTENSIONS.has(path.extname(entry.name))) {
        continue;
      }
      const relativePath = path.relative(REPO_ROOT, path.join(entry.parentPath, entry.name));
      if (!isExemptFile(relativePath)) {
        files.push(relativePath);
      }
    }
  }
  return files.sort();
}

/**
 * One `"<repo-relative file> -> <package>"` string per import, across the
 * scanned roots, whose package is not in `dependencies`.
 */
function findViolations(dependencies: Set<string>): string[] {
  const violations: string[] = [];
  for (const file of scannedFiles()) {
    const source = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    const packages = new Set(bareSpecifiers(source).map(packageName));
    for (const name of [...packages].sort()) {
      if (!dependencies.has(name)) {
        violations.push(`${file.split(path.sep).join('/')} -> ${name}`);
      }
    }
  }
  return violations;
}

function runtimeDependencies(): Set<string> {
  const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  return new Set(Object.keys(manifest.dependencies ?? {}));
}

describe('bareSpecifiers', () => {
  it('reads import … from', () => {
    expect(bareSpecifiers('import express from \'express\';')).toEqual(['express']);
  });

  it('reads a multi-line named import', () => {
    expect(bareSpecifiers('import {\n  one,\n  two,\n} from "pkg";')).toEqual(['pkg']);
  });

  it('reads export … from', () => {
    expect(bareSpecifiers('export { thing } from \'pkg\';')).toEqual(['pkg']);
  });

  it('reads a side-effect import', () => {
    expect(bareSpecifiers('import \'reflect-metadata\';')).toEqual(['reflect-metadata']);
  });

  it('reads a dynamic import()', () => {
    expect(bareSpecifiers('const mod = await import(\'pkg\');')).toEqual(['pkg']);
  });

  it('reads require()', () => {
    expect(bareSpecifiers('const mod = require(\'pkg\');')).toEqual(['pkg']);
  });

  it('skips a statement-level import type', () => {
    expect(bareSpecifiers('import type { Thing } from \'dev-only\';')).toEqual([]);
  });

  it('skips a statement-level export type', () => {
    expect(bareSpecifiers('export type { Thing } from \'dev-only\';')).toEqual([]);
  });

  it('treats an inline { type X } import as a value import', () => {
    expect(bareSpecifiers('import { type Thing, value } from \'pkg\';')).toEqual(['pkg']);
  });

  it('does not carry a type-only statement onto the next import', () => {
    const source = 'export type Alias = string;\nimport value from \'pkg\';';
    expect(bareSpecifiers(source)).toEqual(['pkg']);
  });

  it('does not read a keyword at the end of a string as an import', () => {
    const source = 'const a = { source: \'ics-import\' };\nconst b = x.import(\'pkg\');';
    expect(bareSpecifiers(source)).toEqual([]);
  });

  it('skips relative specifiers', () => {
    expect(bareSpecifiers('import a from \'./a\';\nimport b from \'../b\';')).toEqual([]);
  });

  it('skips the @/ alias', () => {
    expect(bareSpecifiers('import a from \'@/server/a\';')).toEqual([]);
  });

  it('skips node:-prefixed builtins', () => {
    expect(bareSpecifiers('import fs from \'node:fs\';')).toEqual([]);
  });

  it('skips bare builtins, subpaths included', () => {
    expect(bareSpecifiers('import path from \'path\';\nimport fs from \'fs/promises\';')).toEqual([]);
  });
});

describe('packageName', () => {
  it('keeps the first segment of an unscoped specifier', () => {
    expect(packageName('pkg/sub/path')).toBe('pkg');
  });

  it('keeps the first two segments of a scoped specifier', () => {
    expect(packageName('@scope/pkg/sub/path')).toBe('@scope/pkg');
  });
});

describe('isExemptFile', () => {
  it('exempts *.test.ts files', () => {
    expect(isExemptFile('src/server/calendar/service.test.ts')).toBe(true);
  });

  it('exempts anything under a test/ directory', () => {
    expect(isExemptFile('src/server/calendar/test/helpers.ts')).toBe(true);
  });

  it('exempts anything under a test-utils/ directory', () => {
    expect(isExemptFile('src/server/test-utils/factory.ts')).toBe(true);
  });

  it('scans production files', () => {
    expect(isExemptFile('src/server/calendar/service/calendar.ts')).toBe(false);
  });
});

describe('runtime dependencies', () => {
  it('names every importer when a used package is missing from dependencies', () => {
    const dependencies = runtimeDependencies();
    dependencies.delete('axios');

    expect(findViolations(dependencies)).toEqual([
      'src/server/activitypub/helper/http_signature.ts -> axios',
      'src/server/activitypub/helper/remote-fetch.ts -> axios',
      'src/server/activitypub/service/members.ts -> axios',
      'src/server/activitypub/service/outbox.ts -> axios',
      'src/server/calendar/api/v1/category_mappings.ts -> axios',
      'src/server/calendar/service/calendar.ts -> axios',
    ]);
  });

  it('every package imported by production server code is in dependencies', () => {
    expect(findViolations(runtimeDependencies())).toEqual([]);
  });
});
