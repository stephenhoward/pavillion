import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { nextTick, watch } from 'vue';

import { SHELL_SIDEBAR_UP_PX } from '@/client/assets/breakpoints';
import { useShellLayout, resetShellLayoutForTesting } from '@/client/composables/useShellLayout';
import { installMatchMedia, type FakeMatchMedia } from '@/client/test/lib/match-media';

describe('useShellLayout', () => {
  let fake: FakeMatchMedia;

  beforeEach(() => {
    resetShellLayoutForTesting();
    fake = installMatchMedia(false);
  });

  afterEach(() => {
    resetShellLayoutForTesting();
    fake.restore();
  });

  it('builds its media query from SHELL_SIDEBAR_UP_PX', () => {
    useShellLayout();

    expect(fake.queries).toEqual([`(min-width: ${SHELL_SIDEBAR_UP_PX}px)`]);
  });

  it('seeds mainNavIsSidebar as false when the query does not match', () => {
    const { mainNavIsSidebar } = useShellLayout();

    expect(mainNavIsSidebar.value).toBe(false);
  });

  it('seeds mainNavIsSidebar as true when the query matches', () => {
    fake.restore();
    fake = installMatchMedia(true);

    const { mainNavIsSidebar } = useShellLayout();

    expect(mainNavIsSidebar.value).toBe(true);
  });

  it('updates mainNavIsSidebar reactively when the query changes', async () => {
    const { mainNavIsSidebar } = useShellLayout();
    const seen: boolean[] = [];
    watch(mainNavIsSidebar, (value: boolean) => seen.push(value));

    fake.setMatches(true);
    await nextTick();
    expect(mainNavIsSidebar.value).toBe(true);

    fake.setMatches(false);
    await nextTick();
    expect(mainNavIsSidebar.value).toBe(false);

    expect(seen).toEqual([true, false]);
  });

  it('shares one ref and one listener across callers', () => {
    const first = useShellLayout();
    const second = useShellLayout();

    expect(second.mainNavIsSidebar).toBe(first.mainNavIsSidebar);
    expect(fake.queries).toHaveLength(1);
    expect(fake.listenerCount()).toBe(1);
  });

  it('is callable outside a component setup', () => {
    // No component is mounted anywhere in this file; this case names the
    // property the route guards depend on.
    expect(() => useShellLayout()).not.toThrow();
    expect(fake.listenerCount()).toBe(1);
  });

  it('removes its listener and resets the value on resetShellLayoutForTesting', () => {
    const { mainNavIsSidebar } = useShellLayout();
    fake.setMatches(true);

    resetShellLayoutForTesting();

    expect(fake.listenerCount()).toBe(0);
    expect(mainNavIsSidebar.value).toBe(false);
  });

  it('does not attach a listener until first called', () => {
    expect(fake.queries).toHaveLength(0);
    expect(fake.listenerCount()).toBe(0);
  });
});
