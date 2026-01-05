<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useWidgetStore } from '../stores/widgetStore';

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
  </div>
</template>

<style scoped lang="scss">
.widget-root {
  width: 100%;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
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
