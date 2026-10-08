import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  detectSource,
  detect,
  collectThemeFiles,
  main,
  isNonColourVariable,
  NON_COLOUR_FAMILIES,
} from '../check-theme-tokens.js';

/**
 * The bulk of the suite drives the pure `detectSource(code, fileName)` rules
 * with inline fixtures, one per row of the DESIGN §5 table, so it stays fast
 * and independent of the real tree. A separate block covers directory scanning
 * and the CLI exit code, and a final block is the live-scan safety net.
 *
 * File names matter: the Rule 2 and Rule 3 exemptions are keyed on a path
 * suffix, so a fixture names the real file it stands in for.
 */

const MIXINS = 'src/common/ui/assets/mixins.scss';
const SITE_STYLE = 'src/site/assets/style.scss';
const WIDGET_APP = 'src/widget/components/app.vue';
const SITE_COMPONENT = 'src/site/components/event.vue';
const SITE_PARTIAL = 'src/site/assets/_other.scss';

/** An SCSS source from its lines. */
function scssFile(...lines: string[]): string {
  return lines.join('\n');
}

/** A `.vue` source with an optional template and script and any number of style blocks. */
function vueFile({ template = '<div />', script = '', styles = [] as string[] }): string {
  return [
    `<template>\n${template}\n</template>`,
    `<script setup lang="ts">\n${script}\n</script>`,
    ...styles.map(style => `<style scoped lang="scss">\n${style}\n</style>`),
  ].join('\n\n');
}

/** A token layer in the shape mixins.scss has, with `extra` appended after it. */
function tokenLayer(...extra: string[]): string {
  return scssFile(
    '@mixin _public-theme-dark-values {',
    '  color-scheme: dark;',
    '  --pav-surface-primary: #{$dark-surface};',
    '}',
    '',
    '@mixin public-theme-tokens {',
    '  color-scheme: light;',
    '  --pav-surface-primary: #fff;',
    '',
    '  [data-theme="dark"] & {',
    '    @include _public-theme-dark-values;',
    '  }',
    '',
    '  @media (prefers-color-scheme: dark) {',
    '    :where(:root:not([data-theme="light"])) & {',
    '      @include _public-theme-dark-values;',
    '    }',
    '  }',
    '}',
    ...extra,
  );
}

const rulesOf = (code: string, fileName: string) =>
  detectSource(code, fileName).map(v => v.message.split(':')[0]);

describe('check-theme-tokens: Rule 1, compile-time colour', () => {
  it('fails a colour $public-* reference', () => {
    const violations = detectSource(scssFile('.a {', '  color: $public-text-primary-light;', '}'), SITE_PARTIAL);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ line: 2 });
    expect(violations[0].message).toContain('Rule 1: $public-text-primary-light');
  });

  it('fails a colour variable declaration', () => {
    expect(rulesOf('$public-bg-primary-dark: #111;', MIXINS)).toContain('Rule 1');
  });

  it('fails an unlisted new family, which is colour until it is listed', () => {
    expect(rulesOf('.a { border-color: $public-warning-light; }', SITE_PARTIAL)).toEqual(['Rule 1']);
  });

  it('passes the non-colour families, namespaced or not', () => {
    const code = scssFile(
      '$public-space-md: 1rem;',
      '.a { padding: $public-space-md; border-radius: mixins.$public-radius-lg; }',
      '.b { font-family: $public-font-family; font-size: $public-font-size-sm; }',
      '@media (min-width: $public-tablet-breakpoint) { .c { transition: all $public-duration-fast $public-ease-out; } }',
    );
    expect(detectSource(code, SITE_PARTIAL)).toEqual([]);
  });

  it('anchors a family at a - boundary and reads _ as -, as Sass does', () => {
    expect(isNonColourVariable('$public-space-md')).toBe(true);
    expect(isNonColourVariable('$public_space-md')).toBe(true);
    expect(isNonColourVariable('$public-spacewalk')).toBe(false);
    expect(isNonColourVariable('$public_text-primary')).toBe(false);
    expect(NON_COLOUR_FAMILIES).toContain('font');
  });
});

describe('check-theme-tokens: Rule 2, one dark declaration site', () => {
  it.each([
    ['raw prefers-color-scheme: dark', '@media (prefers-color-scheme: dark) { .a { color: red; } }'],
    ['prefers-color-scheme: light', '@media (prefers-color-scheme: light) { .a { color: red; } }'],
    ['combined screen and (prefers-color-scheme: dark)', '@media screen and (prefers-color-scheme: dark) { .a { color: red; } }'],
    ['hand-written [data-theme="dark"] &', '.a { [data-theme="dark"] & { color: red; } }'],
    ['public-dark-mode include', '.a { @include public-dark-mode { color: red; } }'],
    ['namespaced public-dark-mode include', '.a { @include mixins.public-dark-mode { color: red; } }'],
    ['_public-theme-dark-values include', '.a { @include _public-theme-dark-values; }'],
    ['stray color-scheme', '.a { color-scheme: dark; }'],
    ['light-dark(', '.a { color: light-dark(#000, #fff); }'],
    ['.widget-theme-dark class', '.widget-theme-dark .a { color: red; }'],
    ['.widget-theme-light class', '.widget-theme-light { color: red; }'],
  ])('fails a stray %s', (_name, code) => {
    expect(rulesOf(code, SITE_PARTIAL)).toEqual(['Rule 2']);
  });

  it('passes .widget-theme-dark-x and .darken, which are not whole retired class tokens', () => {
    expect(detectSource('.widget-theme-dark-x, .darken, .widget-theme-darkest { color: red; }', SITE_PARTIAL)).toEqual([]);
  });

  it('passes the dark branches inside public-theme-tokens', () => {
    expect(detectSource(tokenLayer(), MIXINS)).toEqual([]);
  });

  it('passes a value inside _public-theme-dark-values', () => {
    const code = tokenLayer().replace('  color-scheme: dark;', '  color-scheme: dark;\n  --pav-text-primary: light-dark(#000, #fff);');
    expect(detectSource(code, MIXINS)).toEqual([]);
  });

  it('fails a dark selector in a neighbouring mixin in mixins.scss', () => {
    const code = tokenLayer('', '@mixin public-filter-pill {', '  [data-theme="dark"] & { color: red; }', '}');
    const violations = detectSource(code, MIXINS);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ line: 22 });
    expect(violations[0].message).toContain('Rule 2: data-theme attribute selector');
  });

  it('fails a public-theme-tokens mixin defined in another file', () => {
    expect(rulesOf(tokenLayer(), SITE_PARTIAL).length).toBeGreaterThan(0);
    expect(new Set(rulesOf(tokenLayer(), SITE_PARTIAL))).toEqual(new Set(['Rule 2']));
  });

  it('exempts nothing when a token-layer mixin is missing', () => {
    const code = tokenLayer().replace('@mixin _public-theme-dark-values {', '@mixin _renamed-dark-values {');
    const violations = detectSource(code, MIXINS);
    expect(violations[0].message).toContain('cannot find balanced @mixin');
    expect(violations.filter(v => v.message.includes('data-theme attribute selector'))).toHaveLength(2);
  });

  it('exempts nothing when a token-layer mixin is unbalanced', () => {
    const code = tokenLayer().replace(/\n}$/, '\n');
    const violations = detectSource(code, MIXINS);
    expect(violations[0].message).toContain('cannot find balanced @mixin');
    expect(violations.some(v => v.message.includes('prefers-color-scheme'))).toBe(true);
  });
});

describe('check-theme-tokens: Rule 3, token-layer include sites', () => {
  it('passes an include at each named site', () => {
    const site = scssFile('#app {', '  display: flex;', '  @include public-theme-tokens;', '}');
    const widget = vueFile({ styles: ['.widget-root {\n  width: 100%;\n  @include public-theme-tokens;\n}'] });
    expect(detectSource(site, SITE_STYLE)).toEqual([]);
    expect(detectSource(widget, WIDGET_APP)).toEqual([]);
  });

  it.each([':root', 'html', '.widget-root .inner', '.widget-container'])(
    'fails an include on %s in a named file',
    (selector) => {
      const code = scssFile('#app {', '  @include public-theme-tokens;', '}', `${selector} {`, '  @include public-theme-tokens;', '}');
      const violations = detectSource(code, SITE_STYLE);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({ line: 5 });
      expect(violations[0].message).toContain(`Rule 3: @include public-theme-tokens on "${selector}"`);
    },
  );

  it('fails an include nested below the named selector', () => {
    const code = vueFile({ styles: ['.widget-root {\n  .inner {\n    @include public-theme-tokens;\n  }\n}'] });
    expect(rulesOf(code, WIDGET_APP)).toEqual(['Rule 3']);
  });

  it('fails an include in another component, even on a named selector', () => {
    const code = vueFile({ styles: ['#app {\n  @include public-theme-tokens;\n}'] });
    expect(rulesOf(code, SITE_COMPONENT)).toEqual(['Rule 3']);
  });
});

describe('check-theme-tokens: Rule 4, token prefix spelling', () => {
  it('fails a mis-cased or underscored --pav prefix, read or declared', () => {
    const code = scssFile('.a {', '  color: var(--Pav-text-primary);', '  --pav_surface: red;', '  background: var(--PAV-surface-primary);', '}');
    expect(detectSource(code, SITE_PARTIAL).map(v => v.line)).toEqual([2, 3, 4]);
  });

  it('passes the correct prefix', () => {
    expect(detectSource('.a { color: var(--pav-text-primary); --pav-local: 1px; }', SITE_PARTIAL)).toEqual([]);
  });
});

describe('check-theme-tokens: comments', () => {
  it('passes a comment mentioning [data-theme] or a colour variable', () => {
    const code = scssFile('// The widget sets [data-theme="dark"] on <html>.', '/* was $public-text-primary-light */', '.a { color: red; }');
    expect(detectSource(code, SITE_PARTIAL)).toEqual([]);
  });

  it('keeps scanning the rest of a line after url(http://x)', () => {
    const code = '.a { background: url(http://x/a.png); color: $public-text-primary-light; }';
    expect(rulesOf(code, SITE_PARTIAL)).toEqual(['Rule 1']);
  });

  it('keeps scanning the rest of a line after a // inside a string', () => {
    const code = '.a::before { content: "//"; color-scheme: dark; }';
    expect(rulesOf(code, SITE_PARTIAL)).toEqual(['Rule 2']);
  });

  it('holds mixin scoping when braces sit in a comment or #{} sits in the body', () => {
    const code = tokenLayer().replace(
      '  color-scheme: light;',
      '  color-scheme: light; // a stray } here\n  /* and { here */\n  --pav-gap: #{$public-space-md};',
    ) + '\n\n.after { color-scheme: dark; }';
    const afterLine = code.split('\n').findIndex(line => line.startsWith('.after')) + 1;
    const violations = detectSource(code, MIXINS);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ line: afterLine });
  });
});

describe('check-theme-tokens: .vue handling', () => {
  it('passes data-theme in <script> and <template>', () => {
    const code = vueFile({
      template: '<div :data-theme="theme" class="widget-theme-dark" />',
      script: 'document.documentElement.setAttribute(\'data-theme\', \'dark\'); const c = \'color-scheme: dark\';',
      styles: ['.a { color: var(--pav-text-primary); }'],
    });
    expect(detectSource(code, SITE_COMPONENT)).toEqual([]);
  });

  it('fails a violation in the second <style> block at its line in the file', () => {
    const code = vueFile({ styles: ['.a { color: red; }', '.b {\n  color: $public-text-primary-light;\n}'] });
    const expectedLine = code.split('\n').findIndex(line => line.includes('$public-text-primary-light')) + 1;
    const violations = detectSource(code, SITE_COMPONENT);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file: SITE_COMPONENT, line: expectedLine });
  });

  it('does not crash on a .vue file with no <style> block', () => {
    expect(detectSource(vueFile({ template: '<p>[data-theme]</p>' }), SITE_COMPONENT)).toEqual([]);
  });
});

describe('check-theme-tokens: directory scan + CLI exit code', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-token-check-'));
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('collectThemeFiles takes .vue and .scss and skips test directories', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.vue'), '');
    fs.writeFileSync(path.join(tmpDir, '_b.scss'), '');
    fs.writeFileSync(path.join(tmpDir, 'c.ts'), '');
    fs.mkdirSync(path.join(tmpDir, 'test'));
    fs.writeFileSync(path.join(tmpDir, 'test', 'fixture.scss'), '');

    expect(collectThemeFiles([tmpDir]).map(f => path.basename(f)).sort()).toEqual(['_b.scss', 'a.vue']);
  });

  it('detect() aggregates violations across files', () => {
    fs.writeFileSync(path.join(tmpDir, 'ok.scss'), '.a { padding: $public-space-md; }\n');
    fs.writeFileSync(path.join(tmpDir, 'bad.scss'), '.a { color-scheme: dark; }\n');
    const violations = detect(collectThemeFiles([tmpDir]));
    expect(violations.map(v => path.basename(v.file))).toEqual(['bad.scss']);
  });

  it('main() exits 0 on a clean root', () => {
    fs.writeFileSync(path.join(tmpDir, 'ok.scss'), '.a { color: var(--pav-text-primary); }\n');
    expect(main([tmpDir])).toBe(0);
    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('no theme-token violations found in 1 file(s)'));
  });

  it('main() exits 1 on a violating root and names file, line and reason', () => {
    fs.writeFileSync(path.join(tmpDir, 'bad.scss'), '.a {\n  color: $public-text-primary-light;\n}\n');
    expect(main([tmpDir])).toBe(1);
    const written = vi.mocked(process.stderr.write).mock.calls.map(call => String(call[0])).join('');
    expect(written).toMatch(/bad\.scss:2 — Rule 1: \$public-text-primary-light/);
    expect(written).toContain('check-theme-tokens: 1 violation(s) found.');
  });
});

/**
 * CI-wiring safety net: the real site, widget and shared-UI tree passes, and
 * the scan reaches both named include sites and the token layer.
 */
describe('check-theme-tokens: live scan (CI safety net)', () => {
  it('reports zero violations against the current tree', () => {
    const files = collectThemeFiles(['src/site', 'src/widget', 'src/common/ui'].map(dir => path.resolve(dir)));
    const relative = files.map(file => path.relative(process.cwd(), file).split(path.sep).join('/'));

    expect(relative).toEqual(expect.arrayContaining([MIXINS, SITE_STYLE, WIDGET_APP]));
    expect(detect(files)).toEqual([]);
  });
});
