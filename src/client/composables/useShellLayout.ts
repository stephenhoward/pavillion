import { readonly, ref, type Ref } from 'vue';

import { SHELL_SIDEBAR_UP_PX } from '@/client/assets/breakpoints';

/**
 * Module-level state shared by every useShellLayout() caller: one ref and one
 * matchMedia listener for the whole app.
 */
const mainNavIsSidebar = ref(false);
let mediaQuery: MediaQueryList | null = null;

function onChange(event: MediaQueryListEvent): void {
  mainNavIsSidebar.value = event.matches;
}

/**
 * Detach the listener and reset the value. Exported for testing purposes only;
 * the app never tears the listener down.
 */
export function resetShellLayoutForTesting(): void {
  mediaQuery?.removeEventListener('change', onChange);
  mediaQuery = null;
  mainNavIsSidebar.value = false;
}

/**
 * Reports whether the shell currently shows the main nav as a sidebar (at
 * SHELL_SIDEBAR_UP_PX and up) rather than as the bottom tab bar.
 *
 * The shell owns this breakpoint; settings derives its tree-as-sidebar state
 * from the same value. The media query is the same `(min-width: 768px)` form
 * that `pav-media(md)` compiles to, so script and stylesheet agree at the
 * boundary.
 *
 * The listener is attached lazily on the first call, never at import time, and
 * uses no lifecycle hooks, so route guards can call this outside a component's
 * setup. State is in memory only; nothing is written to browser storage.
 */
export function useShellLayout(): { mainNavIsSidebar: Readonly<Ref<boolean>> } {
  if (!mediaQuery) {
    mediaQuery = window.matchMedia(`(min-width: ${SHELL_SIDEBAR_UP_PX}px)`);
    mainNavIsSidebar.value = mediaQuery.matches;
    mediaQuery.addEventListener('change', onChange);
  }

  return { mainNavIsSidebar: readonly(mainNavIsSidebar) };
}
