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
import {
  SOURCE_ROOT,
  UI_ROOT,
  UI_TEST_ROOT,
  classify,
  isPermittedOutsideSource,
  parseReferences,
  type Reference,
} from './boundary-scanner';

const SERVER_ROOT = path.join(SOURCE_ROOT, 'server');

const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.vue', '.scss'];

/** App roots that src/common/ui must never import from. */
const FORBIDDEN_ROOTS = ['client', 'site', 'widget', 'server'];

/**
 * Printed with every live-scan failure, so a contributor who trips the scanner
 * while writing documentation is not left to rediscover the header note.
 */
const COMMENTS_ARE_SCANNED = 'the scan is textual: a quoted specifier after from, import, or a Sass '
  + 'at-rule counts even inside a comment or a string literal (write a comment example without '
  + 'quotes, and build a test fixture through QUOTE as boundary.test.ts does)';

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

/** Every module specifier a file on disk imports. */
function references(filePath: string): Reference[] {
  return parseReferences(readFileSync(filePath, 'utf-8'), path.extname(filePath));
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

/*
 * The fixture blocks below drive the classifier with inline sources and
 * made-up file paths — one case per branch — so each rule is pinned whether or
 * not the live tree happens to exercise it. The live-scan describe below is
 * the CI safety net over the real tree.
 *
 * Fixture specifiers are spliced in through QUOTE rather than written between
 * literal quotes: this file sits under src/common/ui, so the live scan reads it
 * too, and a literal fixture would be scanned as an import of its own.
 */
const QUOTE = '\'';

function scriptImport(specifier: string): string {
  return `import x from ${QUOTE}${specifier}${QUOTE};`;
}

function styleUse(specifier: string): string {
  return `@use ${QUOTE}${specifier}${QUOTE};`;
}

/** A component three directories below src/: src/common/ui/components. */
const COMPONENT = path.join(UI_ROOT, 'components/fixture.vue');

/** A source file four directories below src/. */
const NESTED_SOURCE = path.join(UI_ROOT, 'calendar-views/month/fixture.ts');

/** A non-test file under the module, outside its test/ subtree. */
const MODULE_SOURCE = path.join(UI_ROOT, 'composables/fixture.ts');

/** One of the module's own tests. */
const MODULE_TEST = path.join(UI_TEST_ROOT, 'fixture.test.ts');

describe('src/common/ui boundary: parseReferences', () => {
  it('reads only script specifiers in a .ts file, static and dynamic alike', () => {
    const source = [scriptImport('vue'), `const m = import(${QUOTE}./lazy${QUOTE});`, styleUse('sass:color')].join('\n');

    expect(parseReferences(source, '.ts')).toEqual([
      { specifier: 'vue', context: 'script' },
      { specifier: './lazy', context: 'script' },
    ]);
  });

  it('reads only style specifiers in a .scss file', () => {
    const source = [styleUse('sass:color'), `@forward ${QUOTE}./tokens${QUOTE};`, scriptImport('vue')].join('\n');

    expect(parseReferences(source, '.scss')).toEqual([
      { specifier: 'sass:color', context: 'style' },
      { specifier: './tokens', context: 'style' },
    ]);
  });

  it('reads both halves of a .vue file and tags each with its own context', () => {
    const source = [
      '<script setup lang="ts">',
      scriptImport('vue'),
      '</script>',
      '<style scoped lang="scss">',
      styleUse('sass:color'),
      '</style>',
    ].join('\n');

    expect(parseReferences(source, '.vue')).toEqual([
      { specifier: 'vue', context: 'script' },
      { specifier: 'sass:color', context: 'style' },
    ]);
  });

  it('reads a Sass @import in a .vue style block as style only', () => {
    const source = ['<style scoped lang="scss">', `@import ${QUOTE}sass:math${QUOTE};`, '</style>'].join('\n');

    expect(parseReferences(source, '.vue')).toEqual([{ specifier: 'sass:math', context: 'style' }]);
  });

  it('reads a specifier quoted inside a comment, failing safe', () => {
    expect(parseReferences(`// e.g. ${scriptImport('pinia')}`, '.ts'))
      .toEqual([{ specifier: 'pinia', context: 'script' }]);
  });
});

describe('src/common/ui boundary: classify', () => {
  it('reads an @/ alias as a path inside src/', () => {
    expect(classify(COMPONENT, '@/site/stores/x')).toEqual({ kind: 'source', path: 'site/stores/x' });
  });

  it('resolves a relative specifier into src/ however it is spelled', () => {
    expect(classify(COMPONENT, '../../../site/stores/x')).toEqual({ kind: 'source', path: 'site/stores/x' });
  });

  it('treats a climb that lands exactly on src/ as source, not an escape', () => {
    expect(classify(COMPONENT, '../../..')).toEqual({ kind: 'source', path: '' });
    expect(classify(NESTED_SOURCE, '../../../..')).toEqual({ kind: 'source', path: '' });
  });

  it('flags a climb one level past src/ as an escape, at any depth', () => {
    expect(classify(COMPONENT, '../../../../package.json')).toEqual({ kind: 'escape' });
    expect(classify(COMPONENT, '../../../../../outside')).toEqual({ kind: 'escape' });
    expect(classify(NESTED_SOURCE, '../../../../../package.json')).toEqual({ kind: 'escape' });
  });

  it('separates a Sass builtin from a package', () => {
    expect(classify(COMPONENT, 'sass:color')).toEqual({ kind: 'sass-builtin' });
  });

  it('names a package by its root, scoped or not, ignoring any subpath', () => {
    expect(classify(COMPONENT, 'luxon/src/datetime')).toEqual({ kind: 'package', name: 'luxon' });
    expect(classify(COMPONENT, '@vue/test-utils/dist/x')).toEqual({ kind: 'package', name: '@vue/test-utils' });
  });
});

describe('src/common/ui boundary: isPermittedOutsideSource', () => {
  const script = (specifier: string): Reference => ({ specifier, context: 'script' });
  const style = (specifier: string): Reference => ({ specifier, context: 'style' });

  it('permits an allowlisted package', () => {
    expect(isPermittedOutsideSource(COMPONENT, script('vue'))).toBe(true);
    expect(isPermittedOutsideSource(COMPONENT, script('i18next-vue'))).toBe(true);
  });

  it('rejects a package outside the allowlist', () => {
    expect(isPermittedOutsideSource(COMPONENT, script('axios'))).toBe(false);
    expect(isPermittedOutsideSource(COMPONENT, script('pinia'))).toBe(false);
  });

  it('permits a Sass builtin in a style context', () => {
    expect(isPermittedOutsideSource(COMPONENT, style('sass:color'))).toBe(true);
  });

  it('rejects a Sass builtin in a script context', () => {
    expect(isPermittedOutsideSource(COMPONENT, script('sass:color'))).toBe(false);
  });

  it('leaves a climb that lands on src/ to the app-root assertion', () => {
    expect(isPermittedOutsideSource(COMPONENT, script('../../..'))).toBe(true);
  });

  it('rejects a relative escape above src/, whatever the context', () => {
    expect(isPermittedOutsideSource(COMPONENT, script('../../../../package.json'))).toBe(false);
    expect(isPermittedOutsideSource(COMPONENT, style('../../../../node_modules/x'))).toBe(false);
  });

  it('permits a test-only package inside the module test subtree', () => {
    expect(isPermittedOutsideSource(MODULE_TEST, script('vitest'))).toBe(true);
    expect(isPermittedOutsideSource(MODULE_TEST, script('@vue/test-utils'))).toBe(true);
  });

  it('rejects a test-only package outside the module test subtree', () => {
    expect(isPermittedOutsideSource(MODULE_SOURCE, script('vitest'))).toBe(false);
    expect(isPermittedOutsideSource(path.join(UI_ROOT, 'testing/fixture.ts'), script('fs'))).toBe(false);
  });

  it('still rejects an unlisted package inside the module test subtree', () => {
    expect(isPermittedOutsideSource(MODULE_TEST, script('pinia'))).toBe(false);
  });
});

/**
 * CI safety net: the same rules run against the real src/common/ui and
 * src/server trees. Kept apart from the fixture blocks above, which are what
 * pin each branch; this is what catches a real violation landing.
 */
describe('src/common/ui boundary: live scan (CI safety net)', () => {
  it('imports nothing from a single frontend app or from the server', () => {
    const forbidden = new RegExp(`^(${FORBIDDEN_ROOTS.join('|')})(/|$)`);

    expect(violations(UI_ROOT, target => forbidden.test(target)), COMMENTS_ARE_SCANNED).toEqual([]);
  });

  it('is never imported by the server', () => {
    expect(violations(SERVER_ROOT, target => /^common\/ui(\/|$)/.test(target)), COMMENTS_ARE_SCANNED)
      .toEqual([]);
  });

  it('imports no package outside the declared allowlist', () => {
    const offenders = sourceFiles(UI_ROOT).flatMap(filePath => {
      const relativeFile = path.relative(SOURCE_ROOT, filePath);

      return references(filePath)
        .filter(reference => !isPermittedOutsideSource(filePath, reference))
        .map(({ specifier }) => `${relativeFile} -> ${specifier}`);
    });

    expect(offenders, COMMENTS_ARE_SCANNED).toEqual([]);
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
 * `public-*` mixins a shared component may include: each emits only layout,
 * a media query around the caller's own `@content`, or an alpha mask — no
 * colour and no theme selector. Every other `public-*` mixin in
 * assets/mixins.scss reads a compile-time `$public-*` colour, writes a
 * dark-mode rule (`public-dark-mode`, `public-light-mode-override`), or reads
 * `--pav-*` names from inside the mixin, where the TOKENS.md check below
 * cannot see them. Widen this list only with a mixin whose body meets the
 * same bar.
 */
const LAYOUT_ONLY_MIXINS = [
  'public-mobile-only',
  'public-tablet-up',
  'public-desktop-up',
  'public-wide-up',
  'public-sr-only',
  'public-horizontal-scroll',
  'public-scroll-fade-left',
  'public-scroll-fade-right',
  'public-scroll-fade-both',
];

/**
 * Every `public-*` mixin a style block includes that is not layout-only,
 * whether called bare (`@use ... as *`) or through a namespace
 * (`mixins.public-empty-state`).
 */
function disallowedMixinIncludes(style: string): string[] {
  return [...style.matchAll(/@include\s+(?:[\w-]+\.)?(public-[a-z0-9-]+)/g)]
    .map(match => match[1])
    .filter(name => !LAYOUT_ONLY_MIXINS.includes(name));
}

/**
 * Every theme selector or colour-scheme query in a style block. A shared
 * component's tokens already switch under the mounting app's theme selector,
 * so any of these is a shared component reading the wrong value. Like the
 * import scan, this does not strip comments.
 */
function themeSelectors(style: string): string[] {
  return [...style.matchAll(/data-theme|prefers-color-scheme/g)].map(match => match[0]);
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

  it('includes no public-* mixin outside the layout-only allowlist', () => {
    const offenders = sharedComponents().flatMap(filePath =>
      disallowedMixinIncludes(styleBlocks(filePath))
        .map(name => `${path.relative(SOURCE_ROOT, filePath)} -> @include ${name}`));

    expect(offenders).toEqual([]);
  });

  it('writes no dark-mode rule', () => {
    const offenders = sharedComponents().flatMap(filePath =>
      themeSelectors(styleBlocks(filePath))
        .map(selector => `${path.relative(SOURCE_ROOT, filePath)} -> ${selector}`));

    expect(offenders).toEqual([]);
  });

  describe('detectors, against injected violations', () => {
    it('flag a public-* colour or dark-mode mixin however it is namespaced', () => {
      expect(disallowedMixinIncludes('.a { @include public-empty-state; }')).toEqual(['public-empty-state']);
      expect(disallowedMixinIncludes('.a { @include mixins.public-button-base; }')).toEqual(['public-button-base']);
      expect(disallowedMixinIncludes('.a { @include public-dark-mode { color: red; } }')).toEqual(['public-dark-mode']);
      expect(disallowedMixinIncludes('.a { @include public-light-mode-override { color: red; } }'))
        .toEqual(['public-light-mode-override']);
    });

    it('let every allowlisted layout mixin through', () => {
      const style = LAYOUT_ONLY_MIXINS.map(name => `.a { @include mixins.${name}; }`).join('\n');

      expect(disallowedMixinIncludes(style)).toEqual([]);
    });

    it('allowlist only mixins that assets/mixins.scss declares', () => {
      const declared = readFileSync(path.join(UI_ROOT, 'assets/mixins.scss'), 'utf-8');

      for (const name of LAYOUT_ONLY_MIXINS) {
        expect(declared).toMatch(new RegExp(`^@mixin ${name}\\s*\\{`, 'm'));
      }
    });

    it('flag data-theme selectors and prefers-color-scheme queries', () => {
      expect(themeSelectors('[data-theme="dark"] .a { color: red; }')).toEqual(['data-theme']);
      expect(themeSelectors(':root:not([data-theme=light]) .a { color: red; }')).toEqual(['data-theme']);
      expect(themeSelectors('@media (prefers-color-scheme: dark) { .a { color: red; } }'))
        .toEqual(['prefers-color-scheme']);
    });
  });
});
