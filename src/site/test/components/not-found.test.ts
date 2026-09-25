/**
 * Tests for the NotFound page shared by the site and the widget.
 *
 * The widget renders this component under a forced colour mode, set as
 * `data-theme` on the iframe's `<html>`. Its heading and suggestion colours
 * reach the right theme only if the component's compiled, scoped CSS routes
 * every dark rule through the self-guarding `public-dark-mode` mixin:
 *
 * - a forced dark theme has a rule of its own, with the `data-theme` selector
 *   on an ancestor and the scope attribute on the element (a scope attribute
 *   on the ancestor would match nothing — see pv-ezc7);
 * - the OS dark preference only applies where no light theme was forced.
 *
 * The SFC's style block is compiled here with Sass and Vue's scoped-CSS
 * transform, using the scope id the mounted component actually renders, so
 * the rules checked are the rules that reach the rendered elements. The
 * computed colours themselves are asserted end-to-end in
 * tests/e2e/widget-config-roundtrip.spec.ts; happy-dom's selector engine
 * cannot evaluate the guard selector, so it is not used for matching here.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import * as sass from 'sass';
import { parse, compileStyle } from 'vue/compiler-sfc';
import { mount, VueWrapper } from '@vue/test-utils';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import NotFound from '@/site/components/not-found.vue';

const COMPONENT_PATH = path.join(process.cwd(), 'src/site/components/not-found.vue');

/** A style rule from the compiled stylesheet, with its enclosing media query. */
interface CompiledRule {
  selector: string;
  color: string;
  media: string | null;
}

/**
 * Compile the component's `<style scoped lang="scss">` block the way Vite
 * does: Sass (resolving the `@/` alias), then Vue's scoped-CSS rewrite.
 * URLs are rebuilt in this realm because Sass checks `instanceof URL`.
 */
function compileScopedStyle(scopeId: string): string {
  const { descriptor } = parse(readFileSync(COMPONENT_PATH, 'utf8'), { filename: COMPONENT_PATH });
  const style = descriptor.styles[0];
  const toUrl = (file: string) => new URL(pathToFileURL(file).href);

  const css = sass.compileString(style.content, {
    url: toUrl(COMPONENT_PATH),
    logger: sass.Logger.silent,
    importers: [{
      findFileUrl: (url: string) => (url.startsWith('@/')
        ? toUrl(path.join(process.cwd(), 'src', url.slice(2)))
        : null),
    }],
  }).css;

  const result = compileStyle({ source: css, filename: COMPONENT_PATH, id: scopeId, scoped: true });
  if (result.errors.length > 0) {
    throw result.errors[0];
  }
  return result.code;
}

/** Flatten a stylesheet into its colour-setting style rules. */
function colorRules(cssText: string): CompiledRule[] {
  const styleElement = document.createElement('style');
  styleElement.textContent = cssText;
  document.head.appendChild(styleElement);

  const rules: CompiledRule[] = [];
  const walk = (list: CSSRuleList, media: string | null) => {
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSMediaRule) {
        walk(rule.cssRules, rule.media.mediaText);
      }
      else if (rule instanceof CSSStyleRule && rule.style.color) {
        rules.push({ selector: rule.selectorText, color: rule.style.color, media });
      }
    }
  };
  walk(styleElement.sheet!.cssRules, null);
  styleElement.remove();
  return rules;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('NotFound', () => {
  let wrapper: VueWrapper;
  let scopeId: string;
  let rules: CompiledRule[];

  beforeAll(async () => {
    const systemBundle = {
      not_found_error_message: 'Not Found',
      not_found_suggestion: 'The calendar or event you are looking for does not exist.',
      not_found_go_home: 'Go to Homepage',
    };
    if (!i18next.isInitialized) {
      await i18next.init({ lng: 'en', resources: { en: { system: systemBundle } } });
    }
    else {
      i18next.addResourceBundle('en', 'system', systemBundle, true, true);
    }

    wrapper = mount(NotFound, { global: { plugins: [[I18NextVue, { i18next }]] } });
    const heading = wrapper.find('h1').element;
    scopeId = Array.from(heading.attributes).map(a => a.name).find(name => name.startsWith('data-v-'))!;
    rules = colorRules(compileScopedStyle(scopeId));
  });

  afterAll(() => {
    wrapper.unmount();
  });

  it('renders the heading, suggestion and a link home', () => {
    expect(wrapper.find('h1').text()).toBe('Not Found');
    expect(wrapper.find('p').text()).toBe('The calendar or event you are looking for does not exist.');
    const link = wrapper.find('a.not-found-home-link');
    expect(link.attributes('href')).toBe('/');
    expect(link.text()).toBe('Go to Homepage');
  });

  it('renders its heading and suggestion under the scope id its styles target', () => {
    expect(scopeId).toMatch(/^data-v-/);
    expect(wrapper.find('p').attributes()).toHaveProperty(scopeId);
  });

  describe.each(['h1', 'p'])('%s colour', (element) => {
    const target = () => new RegExp(`\\.not-found ${element}\\[${escapeRegExp(scopeId)}\\]$`);
    const forElement = () => rules.filter(rule => target().test(rule.selector));

    it('has a light base colour outside any theme selector', () => {
      const base = forElement().filter(rule => rule.media === null && !rule.selector.includes('data-theme'));
      expect(base).toHaveLength(1);
    });

    it('is recoloured by a forced dark theme on an ancestor, whatever the OS prefers', () => {
      const base = forElement().find(rule => rule.media === null && !rule.selector.includes('data-theme'))!;
      const forcedDark = forElement().filter(
        rule => rule.media === null && /^\[data-theme="?dark"?\] /.test(rule.selector),
      );

      expect(forcedDark).toHaveLength(1);
      expect(forcedDark[0].color).not.toBe(base.color);
    });

    it('follows the OS dark preference only where no light theme was forced', () => {
      const forcedDark = forElement().find(rule => /^\[data-theme="?dark"?\] /.test(rule.selector))!;
      const osDark = forElement().filter(rule => rule.media?.includes('prefers-color-scheme: dark'));

      // At least one rule keeps `auto` following the OS; every one of them
      // stands down under data-theme="light".
      expect(osDark.length).toBeGreaterThan(0);
      for (const rule of osDark) {
        expect(rule.selector).toMatch(/^:where\(:root:not\(\[data-theme="?light"?\]\)\) /);
        expect(rule.color).toBe(forcedDark.color);
      }
    });
  });
});
