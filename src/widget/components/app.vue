<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { useWidgetStore } from '../stores/widgetStore';

const { t } = useTranslation('system');
const widgetStore = useWidgetStore();
const route = useRoute();
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
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
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
