<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { useWidgetStore } from '../stores/widgetStore';

const { t } = useTranslation('system');
const widgetStore = useWidgetStore();
const route = useRoute();
const router = useRouter();
const rootRef = ref<HTMLElement | null>(null);

/**
 * Report the widget's height to the embedding page whenever it changes.
 *
 * The SDK sizes the iframe to the reported height, so it must be the height
 * of the content alone: .widget-root is the whole document (no body margin,
 * no viewport-relative height), and its border box is what the frame has to
 * hold. Anything tied to the viewport would feed the iframe's current height
 * back into the report, and the frame could then grow but never shrink.
 */
let resizeObserver: ResizeObserver | null = null;
let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
// Route-change height hold; see holdHeight below.
let navigationCount = 0;
let busyObserver: MutationObserver | null = null;
let removeRouterHooks: Array<() => void> = [];

onMounted(() => {
  const root = rootRef.value;
  if (root) {
    // Apply initial configuration
    widgetStore.injectAccentColor(root);
    widgetStore.applyColorMode();

    resizeObserver = new ResizeObserver(() => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      // Debounced; measured when the timer fires, so the latest size is sent.
      // Rounded up so a fractional height can't clip the footer by a sub-pixel.
      resizeTimeout = setTimeout(() => {
        widgetStore.notifyResize(Math.ceil(root.getBoundingClientRect().height));
      }, 100);
    });

    resizeObserver.observe(root);

    removeRouterHooks = [
      router.beforeEach(() => {
        navigationCount++;
        holdHeight(root);
      }),
      router.afterEach(() => releaseWhenSettled(root)),
      router.onError(() => releaseHeight(root)),
    ];
  }
});

/**
 * Hold the frame's height across a route change.
 *
 * A routed view renders a short loading state while it fetches, and
 * reporting that would collapse the iframe until the data arrives. From
 * the start of a navigation the root keeps its current height as an inline
 * min-height; it is released once the new view has settled, which is when
 * nothing under the root is marked `aria-busy="true"`. A view that never
 * goes busy (rendered from cached data) is released on the first check
 * after it renders. Released, the root is back to its content height, so
 * the frame can still shrink to a shorter view.
 */
const isBusy = (root: HTMLElement) => root.querySelector('[aria-busy="true"]') !== null;

function holdHeight(root: HTMLElement) {
  busyObserver?.disconnect();
  busyObserver = null;
  root.style.minHeight = `${Math.ceil(root.getBoundingClientRect().height)}px`;
}

function releaseHeight(root: HTMLElement) {
  busyObserver?.disconnect();
  busyObserver = null;
  root.style.minHeight = '';
}

async function releaseWhenSettled(root: HTMLElement) {
  const navigation = navigationCount;
  // afterEach runs before the new route renders; the views set their
  // loading state before their first render, so one tick shows it.
  await nextTick();
  if (navigation !== navigationCount) {
    return; // A later navigation owns the hold now.
  }
  if (!isBusy(root)) {
    releaseHeight(root);
    return;
  }
  busyObserver = new MutationObserver(() => {
    if (!isBusy(root)) {
      releaseHeight(root);
    }
  });
  busyObserver.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-busy'],
  });
}

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  busyObserver?.disconnect();
  removeRouterHooks.forEach((remove) => remove());
  removeRouterHooks = [];
  if (resizeTimeout) {
    clearTimeout(resizeTimeout);
  }
});

// Watch for theme changes from postMessage updates
watch(() => widgetStore.colorMode, () => {
  widgetStore.applyColorMode();
});

// Watch for accent color changes from postMessage updates
watch(() => widgetStore.accentColor, () => {
  if (rootRef.value) {
    widgetStore.injectAccentColor(rootRef.value);
  }
});

// Watch for route changes and notify parent
watch(() => route.fullPath, (newPath) => {
  widgetStore.notifyNavigation(newPath);
});
</script>

<template>
  <div
    ref="rootRef"
    class="widget-root">
    <RouterView />
    <footer class="widget-footer">
      <a href="https://pavillion.social" target="_blank" rel="noopener noreferrer">
        <span class="pavillion-logo" aria-hidden="true"/> {{ t('powered_by') }}
      </a>
    </footer>
  </div>
</template>

<style scoped lang="scss">
@use '@/site/assets/mixins' as *;

// No viewport-relative height: the root's height is the height reported to
// the embedding page (see the ResizeObserver above).
.widget-root {
  width: 100%;
  display: flex;
  flex-direction: column;

  // Last among the declarations: the mixin ends in a nested dark-mode rule,
  // and a declaration after a nested rule makes Sass split this one.
  @include public-theme-tokens;
}

.widget-footer {
  flex: 0 0 auto;
  padding: $public-space-sm $public-space-md;
  border-top: 1px solid var(--pav-border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: $public-font-size-xs;
  text-align: center;
  color: var(--pav-text-secondary);

  a {
    color: inherit;
    display: inline-flex;
    align-items: center;
    gap: $public-space-sm;
    text-decoration: none;

    &:hover {
      color: var(--pav-accent-hover);
    }

    &:focus-visible {
      @include public-focus-visible;
    }
  }

  .pavillion-logo {
    display: inline-block;
    background-color: var(--pav-text-primary);
    mask-size: contain;
    mask-repeat: no-repeat;
    mask-image: url('@/client/assets/pavillion-logo.svg');
    -webkit-mask-size: contain;
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-image: url('@/client/assets/pavillion-logo.svg');
    width: 16px;
    height: 16px;
  }
}

// Native controls follow the widget's color mode: the OS preference under
// `auto` (no data-theme), the forced mode otherwise.
.widget-root {
  color-scheme: light dark;

  [data-theme="light"] & {
    color-scheme: light;
  }

  [data-theme="dark"] & {
    color-scheme: dark;
  }
}
</style>
