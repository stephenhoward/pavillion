/**
 * Screen Reader Test Helper
 *
 * Thin wrappers around `@guidepup/virtual-screen-reader` for use in two
 * complementary test contexts:
 *
 *  - `screenReader(element)`    — Vitest (happy-dom / jsdom), drives VSR
 *                                  against a `wrapper.element` from
 *                                  `@vue/test-utils`.
 *  - `pageScreenReader(page)`   — Playwright, injects VSR into the page
 *                                  context via `addInitScript` and drives
 *                                  it through `page.evaluate()`.
 *
 * Both surfaces expose the same five primitives:
 *
 *   - `walk(): Promise<string[]>`      Walk the document from the start,
 *                                      collecting every spoken phrase.
 *   - `next(): Promise<void>`          Move to the next accessibility node.
 *   - `previous(): Promise<void>`      Move to the previous accessibility
 *                                      node.
 *   - `lastPhrase(): Promise<string>`  Return the most recently spoken
 *                                      phrase.
 *   - `act(): Promise<void>`           Activate the currently focused
 *                                      element (analogous to pressing the
 *                                      screen reader's primary action key).
 *
 * Locale lock: both variants force `i18next` to `'en'` before walking and
 * restore the previous language on teardown (via the returned `stop()`).
 * Individual tests do not need to manage locale.
 *
 * Design reference:
 *   `docs/superpowers/specs/2026-05-13-screen-reader-testing-design.md`
 *   § Architecture, § Phase 1.
 *
 * happy-dom note: as of `@guidepup/virtual-screen-reader@0.32` and
 * `happy-dom@15`, the Vitest variant runs under the project's default
 * happy-dom environment — the Phase 1 spike confirmed VSR walks the
 * accessibility tree of mounted Vue components without an environment
 * swap. If a future VSR or happy-dom upgrade regresses, the per-file
 * escape hatch is to add `// @vitest-environment jsdom` to the affected
 * test file (jsdom is already in `devDependencies`).
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { virtual } from '@guidepup/virtual-screen-reader';
import i18next from 'i18next';
import type { Page } from '@playwright/test';

// The Vitest/Node test runners load this module as ESM, so `require` is
// not a global. `createRequire` provides a CJS-style resolver bound to
// this module's URL — used only by the Playwright variant to locate the
// VSR browser bundle on disk.
const req = createRequire(import.meta.url);

/**
 * The shared screen-reader API surface. Both `screenReader()` and
 * `pageScreenReader()` return objects conforming to this shape, so tests
 * authored against the Vitest variant translate directly to Playwright
 * (and vice versa).
 */
export interface ScreenReaderHandle {
  /**
   * Walk the document from the current position to the end, returning the
   * full spoken-phrase log accumulated during the walk.
   */
  walk(): Promise<string[]>;
  /** Move forward one accessibility node. */
  next(): Promise<void>;
  /** Move backward one accessibility node. */
  previous(): Promise<void>;
  /** The most recently spoken phrase (e.g. after `next()` or `act()`). */
  lastPhrase(): Promise<string>;
  /** Activate the currently focused element. */
  act(): Promise<void>;
  /** Stop the virtual SR and restore the previous i18next language. */
  stop(): Promise<void>;
}

const LOCALE = 'en';

/**
 * Lock i18next to English for the duration of a screen-reader test. Returns
 * a restore function that resets the previous language.
 *
 * Vitest tests typically have i18next initialized via `mountComponent`'s
 * call to `initI18Next()`. Playwright tests do not initialize i18next in
 * the *test process* (the browser context's i18next is a separate runtime
 * managed by the application). When `i18next.isInitialized` is false the
 * lock is a no-op — the page-side locale must be controlled by the test
 * (cookie, URL, or UI interaction).
 */
async function lockLocale(): Promise<() => Promise<void>> {
  if (!i18next.isInitialized) {
    return async () => { /* nothing to restore */ };
  }
  const previous = i18next.language;
  if (previous !== LOCALE) {
    await i18next.changeLanguage(LOCALE);
  }
  return async () => {
    if (previous && previous !== LOCALE) {
      await i18next.changeLanguage(previous);
    }
  };
}

/**
 * Create a virtual screen reader bound to a DOM element (typically a
 * Vue Test Utils `wrapper.element`).
 *
 * The helper starts the virtual SR against the supplied container, forces
 * the i18next locale to `'en'`, and exposes the shared primitive API. Call
 * `stop()` on the returned handle in your test teardown to release the
 * virtual SR and restore the previous locale.
 */
export async function screenReader(element: Node): Promise<ScreenReaderHandle> {
  const restoreLocale = await lockLocale();
  await virtual.start({ container: element });

  return {
    async walk() {
      await virtual.clearSpokenPhraseLog();
      // Walk forward, stopping at the "end of document" sentinel (which
      // VSR emits when the container is the full document) or when the
      // active node returns to the starting node (which is what happens
      // when VSR is bound to a sub-tree — it cycles instead of emitting
      // a terminal phrase). Capped to defeat runaway loops in case a
      // future VSR release changes its traversal semantics.
      const startNode = virtual.activeNode;
      const maxSteps = 2000;
      for (let i = 0; i < maxSteps; i++) {
        await virtual.next();
        const last = await virtual.lastSpokenPhrase();
        if (last === 'end of document') {
          break;
        }
        if (i > 0 && virtual.activeNode === startNode) {
          break;
        }
      }
      return virtual.spokenPhraseLog();
    },
    async next() {
      await virtual.next();
    },
    async previous() {
      await virtual.previous();
    },
    async lastPhrase() {
      return virtual.lastSpokenPhrase();
    },
    async act() {
      await virtual.act();
    },
    async stop() {
      await virtual.stop();
      await restoreLocale();
    },
  };
}

/**
 * Resolve the path to the VSR browser ESM bundle, then read it once and
 * wrap it as a plain script that exposes `window.virtual` and
 * `window.Virtual`. The bundle ships as an ES module (`export { ... }`),
 * which `page.addScriptTag` won't load as a regular `<script>`; wrapping
 * it in a `<script type="module">` plus a side-effect to publish the
 * exports onto `window` is the most portable way to drive VSR from
 * Playwright without requiring the test page to ship VSR itself.
 *
 * The bundle source path is resolved against the CJS entry's directory,
 * which works in both ESM-loaded and CJS-loaded test runners.
 */
function buildPlaywrightInjection(): string {
  const cjsEntry = req.resolve('@guidepup/virtual-screen-reader');
  const browserBundle = join(dirname(cjsEntry), '..', 'esm', 'index.browser.js');
  const source = readFileSync(browserBundle, 'utf8');
  // The bundle ends with `export { Uo as Virtual, X$ as virtual };`.
  // Rewrite to publish onto `window` and drop the `export` statement so
  // the script can be evaluated as a plain script (or module) in the page
  // context.
  return source.replace(
    /export\s*\{\s*([^}]+)\s*\}\s*;?\s*$/m,
    (_match, exports) => {
      const pairs = (exports as string).split(',').map(s => s.trim());
      const assignments: string[] = [];
      for (const pair of pairs) {
        const m = /^(\S+)\s+as\s+(\S+)$/.exec(pair);
        if (m) {
          assignments.push(`window.${m[2]} = ${m[1]};`);
        }
        else {
          assignments.push(`window.${pair} = ${pair};`);
        }
      }
      return assignments.join('\n');
    },
  );
}

/**
 * Verify that `addInitScript` injection succeeded — i.e. `window.virtual`
 * is defined in the page context. Throws a descriptive error if not, so a
 * future change to VSR's bundle export format surfaces immediately rather
 * than producing a confusing `undefined` failure downstream.
 */
async function assertVsrInjected(page: Page): Promise<void> {
  const ok = await page.evaluate(() => typeof (window as { virtual?: unknown }).virtual !== 'undefined');
  if (!ok) {
    throw new Error(
      'VSR injection failed: window.virtual is not defined. '
      + 'The @guidepup/virtual-screen-reader bundle export format may have changed; '
      + 'inspect buildPlaywrightInjection() in src/common/test-utils/screen-reader.ts.',
    );
  }
}

/**
 * Lazily start the virtual SR against the current page document.
 *
 * The handle is attached once via `addInitScript`, which fires on every
 * navigation. Each navigation produces a fresh document with `window.virtual`
 * present but no active session — so the first method call after attachment
 * (or after a navigation) must call `virtual.start()` against the new
 * document. The `__pavillion_vsr_active` flag on `window` is reset by every
 * navigation, which is exactly the signal we want.
 */
async function ensureStarted(page: Page): Promise<void> {
  await assertVsrInjected(page);
  await page.evaluate(async () => {
    const w = window as unknown as {
      virtual: { start: (opts: { container: Node }) => Promise<void> };
      __pavillion_vsr_active?: boolean;
    };
    if (!w.__pavillion_vsr_active) {
      await w.virtual.start({ container: document.body });
      w.__pavillion_vsr_active = true;
    }
  });
}

/**
 * Create a virtual screen reader bound to a Playwright `Page`.
 *
 * Injects `@guidepup/virtual-screen-reader` into the page context via
 * `addInitScript` (so it survives navigations), then drives it through
 * `page.evaluate()`. The locale lock applies to the *test process*
 * i18next instance, not the page's; the page-side locale must be managed
 * by the test itself (e.g. via UI interaction or the locale cookie).
 *
 * Usage pattern: call `pageScreenReader(page)` *before* navigating to the
 * target route so the init script is in place for the page's first load.
 * The virtual SR session is started lazily on first method call and
 * automatically re-started after every navigation, so callers do not need
 * to track session lifecycle across page transitions.
 *
 * If `pageScreenReader(page)` is called on an already-loaded page, the
 * page is reloaded so the init script can attach VSR; the lazy start then
 * binds the session to the reloaded document.
 */
export async function pageScreenReader(page: Page): Promise<ScreenReaderHandle> {
  const restoreLocale = await lockLocale();

  // Inject VSR into every navigation context as `window.virtual` /
  // `window.Virtual`. addInitScript only fires on subsequent loads, so
  // reload if a non-blank page is already open. The about:blank case
  // (helper attached before first navigation) is the recommended flow
  // and requires no reload.
  const injection = buildPlaywrightInjection();
  await page.addInitScript(injection);

  if (page.url() !== 'about:blank') {
    await page.reload();
    // Verify the injection actually landed on the reloaded page. For the
    // about:blank case we defer this check to the first method call,
    // which is the earliest point a meaningful document exists.
    await assertVsrInjected(page);
  }

  return {
    async walk() {
      await ensureStarted(page);
      return page.evaluate(async () => {
        const v = (window as unknown as {
          virtual: {
            activeNode: Node | null;
            clearSpokenPhraseLog: () => Promise<void>;
            lastSpokenPhrase: () => Promise<string>;
            next: () => Promise<void>;
            spokenPhraseLog: () => Promise<string[]>;
          };
        }).virtual;
        await v.clearSpokenPhraseLog();
        const startNode = v.activeNode;
        const maxSteps = 2000;
        for (let i = 0; i < maxSteps; i++) {
          await v.next();
          const last = await v.lastSpokenPhrase();
          if (last === 'end of document') break;
          if (i > 0 && v.activeNode === startNode) break;
        }
        return v.spokenPhraseLog();
      });
    },
    async next() {
      await ensureStarted(page);
      await page.evaluate(async () => {
        await (window as unknown as { virtual: { next: () => Promise<void> } }).virtual.next();
      });
    },
    async previous() {
      await ensureStarted(page);
      await page.evaluate(async () => {
        await (window as unknown as { virtual: { previous: () => Promise<void> } }).virtual.previous();
      });
    },
    async lastPhrase() {
      await ensureStarted(page);
      return page.evaluate(async () => {
        return (window as unknown as { virtual: { lastSpokenPhrase: () => Promise<string> } }).virtual.lastSpokenPhrase();
      });
    },
    async act() {
      await ensureStarted(page);
      await page.evaluate(async () => {
        await (window as unknown as { virtual: { act: () => Promise<void> } }).virtual.act();
      });
    },
    async stop() {
      // Only stop if a session was actually started — if the caller
      // attached the helper but never invoked a method, there is nothing
      // to tear down on the page side.
      await page.evaluate(async () => {
        const w = window as unknown as {
          virtual?: { stop: () => Promise<void> };
          __pavillion_vsr_active?: boolean;
        };
        if (w.__pavillion_vsr_active && w.virtual) {
          await w.virtual.stop();
          w.__pavillion_vsr_active = false;
        }
      });
      await restoreLocale();
    },
  };
}
