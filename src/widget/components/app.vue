<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { useWidgetStore } from '../stores/widgetStore';

const { t } = useTranslation('system');
const widgetStore = useWidgetStore();
const route = useRoute();
const rootRef = ref<HTMLElement | null>(null);

/**
 * Set up ResizeObserver to notify parent of height changes
 */
let resizeObserver: ResizeObserver | null = null;
let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

onMounted(() => {
  if (rootRef.value) {
    // Apply initial configuration
    widgetStore.injectAccentColor(rootRef.value);
    widgetStore.applyColorMode(rootRef.value);

    // Set up resize observer with debouncing
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Debounce resize notifications
        if (resizeTimeout) {
          clearTimeout(resizeTimeout);
        }

        resizeTimeout = setTimeout(() => {
          const height = entry.contentRect.height;
          widgetStore.notifyResize(height);
        }, 100); // 100ms debounce
      }
    });

    resizeObserver.observe(rootRef.value);
  }
});

// Watch for theme changes from postMessage updates
watch(() => widgetStore.colorMode, () => {
  if (rootRef.value) {
    widgetStore.applyColorMode(rootRef.value);
  }
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

// Cleanup on unmount
onMounted(() => {
  return () => {
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
    if (resizeTimeout) {
      clearTimeout(resizeTimeout);
    }
  };
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

.widget-root {
  @include public-accent-tokens;

  width: 100%;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.widget-footer {
  flex: 0 0 auto;
  padding: $public-space-sm $public-space-md;
  border-top: 1px solid $public-border-subtle-light;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: $public-font-size-xs;
  text-align: center;
  color: $public-text-secondary-light;

  @include public-dark-mode {
    border-top-color: $public-border-subtle-dark;
    color: $public-text-secondary-dark;
  }

  a {
    color: inherit;
    display: inline-flex;
    align-items: center;
    gap: $public-space-sm;
    text-decoration: none;

    &:hover {
      color: $public-accent-hover-light;

      @include public-dark-mode {
        color: $public-accent-hover-dark;
      }
    }
  }

  .pavillion-logo {
    display: inline-block;
    background-color: $public-text-primary-light;
    mask-size: contain;
    mask-repeat: no-repeat;
    mask-image: url('@/client/assets/pavillion-logo.svg');
    -webkit-mask-size: contain;
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-image: url('@/client/assets/pavillion-logo.svg');
    width: 16px;
    height: 16px;

    @include public-dark-mode {
      background-color: $public-text-primary-dark;
    }
  }
}

// Auto color mode (uses system preference)
@media (prefers-color-scheme: dark) {
  .widget-root:not(.widget-theme-light) {
    // Dark mode styles will be inherited from parent SCSS
  }
}

// Forced light theme
.widget-root.widget-theme-light {
  color-scheme: light;
}

// Forced dark theme
.widget-root.widget-theme-dark {
  color-scheme: dark;
}
</style>
