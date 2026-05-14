import { describe, it, expect, afterEach } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { mountComponent } from '@/client/test/lib/vue';
import ToggleSwitch from '@/client/components/common/toggle_switch.vue';
import { screenReader, type ScreenReaderHandle } from '@/common/test-utils/screen-reader';

/**
 * Smoke test for the Vitest variant of the screen-reader helper.
 *
 * Scope: verifies that `screenReader(element)` can attach to a real Vue
 * component's rendered DOM under happy-dom and return a non-empty spoken-
 * phrase log via `walk()`. This is intentionally minimal — exhaustive
 * announcement coverage is the Phase 2 corpus's job, not this file's.
 */

const routes: RouteRecordRaw[] = [
  { path: '/', component: {}, name: 'home' },
];

describe('screen-reader helper (Vitest variant)', () => {
  let sr: ScreenReaderHandle | undefined;

  afterEach(async () => {
    if (sr) {
      await sr.stop();
      sr = undefined;
    }
  });

  it('walks a rendered component and returns a non-empty spoken-phrase log', async () => {
    const router: Router = createRouter({
      history: createMemoryHistory(),
      routes,
    });

    const wrapper = mountComponent(ToggleSwitch, router, {
      props: {
        modelValue: true,
        label: 'Notifications',
        id: 'notifications-toggle',
      },
    });

    sr = await screenReader(wrapper.element as unknown as Node);
    const phrases = await sr.walk();

    expect(Array.isArray(phrases)).toBe(true);
    expect(phrases.length).toBeGreaterThan(0);
    // Sanity-check: the label or the switch role should appear somewhere
    // in the walk. Exact phrasing is the Phase 2 corpus's concern; here
    // we only care that VSR successfully traversed the rendered DOM.
    const joined = phrases.join(' | ');
    expect(joined.toLowerCase()).toMatch(/switch|notifications/);
  });

  it('reports the last spoken phrase after walking', async () => {
    const router: Router = createRouter({
      history: createMemoryHistory(),
      routes,
    });

    const wrapper = mountComponent(ToggleSwitch, router, {
      props: {
        modelValue: false,
        label: 'Notifications',
        id: 'notifications-toggle',
      },
    });

    sr = await screenReader(wrapper.element as unknown as Node);
    await sr.walk();
    const last = await sr.lastPhrase();

    expect(typeof last).toBe('string');
    expect(last.length).toBeGreaterThan(0);
  });
});
