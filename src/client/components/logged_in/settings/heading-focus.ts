import { onMounted, onUnmounted, type Ref } from 'vue';

/**
 * The settings layout renders exactly one page header, so its h1 is the one
 * match for this selector. Callers that move focus to the page title (the
 * skip control, the resize-down handler, the page-mode focus rule) go through
 * {@link focusSettingsHeading} rather than wiring a ref through the layout.
 */
export const SETTINGS_HEADING_SELECTOR = '.settings-page-header__title';

/** Move focus to the settings page heading, if one is rendered. */
export function focusSettingsHeading(): void {
  document.querySelector<HTMLElement>(SETTINGS_HEADING_SELECTOR)?.focus();
}

/**
 * Whether focus is, or was until a hide dropped it to the body, inside `el`.
 *
 * Chromium blurs a newly display: none element before the matchMedia change
 * event fires, so a viewport watch that reads document.activeElement alone
 * sees the body. A document-level focusin listener records whether focus last
 * landed inside `el`; the blur that a hide causes fires no focusin, so the
 * record survives it. A press on non-focusable space also blurs to the body
 * without a focusin, so a pointerdown outside `el` clears the record.
 * Page-mode only; pv-ms7c may replace this with a general focus rule.
 */
export function useFocusWithin(el: Ref<HTMLElement | null>): () => boolean {
  let lastFocusInside = false;
  const isInside = (target: EventTarget | null): boolean =>
    !!el.value && target instanceof Node && el.value.contains(target);
  const onFocusIn = (event: FocusEvent): void => {
    lastFocusInside = isInside(event.target);
  };
  const onPointerDown = (event: Event): void => {
    if (!isInside(event.target)) {
      lastFocusInside = false;
    }
  };
  onMounted(() => {
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('pointerdown', onPointerDown, true);
  });
  onUnmounted(() => {
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('pointerdown', onPointerDown, true);
  });

  return () => {
    const active = document.activeElement;
    if (el.value?.contains(active)) {
      return true;
    }
    return (!active || active === document.body) && lastFocusInside;
  };
}
