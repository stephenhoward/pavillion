<template>
  <!--
    Graceful Image Component
    ========================
    If image loads successfully, display it.
    If image fails or doesn't exist, render nothing.
    No placeholders. No broken experiences. Just content.
  -->
  <div
    v-if="shouldShow"
    class="event-image"
    :class="[`context-${context}`, { 'is-loading': isLoading }]"
  >
    <!-- Elegant loading state - subtle, unobtrusive -->
    <div v-if="isLoading" class="image-loading">
      <div class="loading-pulse" />
    </div>

    <!-- The image itself -->
    <img
      v-show="imageLoaded"
      :src="imageBlobUrl"
      :alt="media?.originalFilename || ''"
      @load="handleImageLoad"
      @error="handleImageError"
      class="image-content"
    />

    <!-- Subtle vignette overlay for depth -->
    <div class="image-vignette" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';

interface MediaObject {
  id: string;
  originalFilename?: string;
}

const props = defineProps<{
  media: MediaObject | null;
  context?: 'card' | 'hero' | 'feature';
  lazy?: boolean;
}>();

const isLoading = ref(true);
const imageLoaded = ref(false);
const imageFailed = ref(false);
const imageBlobUrl = ref<string | null>(null);

// Component only shows if media exists AND image hasn't failed
const shouldShow = computed(() => {
  return props.media && !imageFailed.value;
});

const imageUrl = computed(() => {
  if (!props.media) return '';
  return `/api/v1/media/${props.media.id}`;
});

/**
 * Fetch image once. No retries.
 * If the image is still processing (202) or fails, we simply don't show it.
 */
const fetchImage = async () => {
  if (!props.media) return;

  try {
    const response = await fetch(imageUrl.value);

    // Only show image if it's immediately available
    if (response.ok) {
      const blob = await response.blob();
      imageBlobUrl.value = URL.createObjectURL(blob);
      // Keep loading true until img onload fires
    }
    else {
      // 202 (processing) or any error - gracefully hide
      imageFailed.value = true;
      isLoading.value = false;
    }
  }
  catch {
    // Network error - gracefully hide
    imageFailed.value = true;
    isLoading.value = false;
  }
};

const handleImageLoad = () => {
  isLoading.value = false;
  imageLoaded.value = true;
};

const handleImageError = () => {
  imageFailed.value = true;
  isLoading.value = false;
};

const cleanup = () => {
  if (imageBlobUrl.value) {
    URL.revokeObjectURL(imageBlobUrl.value);
    imageBlobUrl.value = null;
  }
};

// Watch for media changes
watch(() => props.media?.id, (newId, oldId) => {
  if (newId !== oldId) {
    cleanup();
    imageFailed.value = false;
    imageLoaded.value = false;
    isLoading.value = true;
    if (newId) {
      fetchImage();
    }
  }
}, { immediate: false });

onMounted(() => {
  if (props.media) {
    fetchImage();
  }
  else {
    isLoading.value = false;
  }
});

onUnmounted(() => {
  cleanup();
});
</script>

<style scoped lang="scss">
@use '../assets/mixins' as *;

// ================================================================
// IMAGE COMPONENT
// ================================================================
// A minimal image display. No placeholders.
// ================================================================

.event-image {
  position: relative;
  width: 100%;
  overflow: hidden;
  background-color: $public-bg-tertiary-light;
  border-radius: $public-radius-md;

  @include public-dark-mode {
    background-color: $public-bg-tertiary-dark;
  }

  .image-content {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    opacity: 0;
    transition: opacity $public-duration-slow $public-ease-out;
  }

  // Fade in when loaded
  &:not(.is-loading) .image-content {
    opacity: 1;
  }

  // Vignette for subtle depth
  .image-vignette {
    position: absolute;
    inset: 0;
    pointer-events: none;
    box-shadow: inset 0 0 40px rgba(0, 0, 0, 0.06);

    @include public-dark-mode {
      box-shadow: inset 0 0 40px rgba(0, 0, 0, 0.15);
    }
  }
}

// ================================================================
// CONTEXT: CARD THUMBNAIL
// ================================================================
// Compact display for event list cards.
// Slightly shorter aspect ratio to leave room for text below.

.context-card {
  aspect-ratio: 16 / 10;
  border-radius: $public-radius-sm;
  box-shadow: $public-shadow-xs-light;

  @include public-dark-mode {
    box-shadow: $public-shadow-xs-dark;
  }

  .image-content {
    border-radius: $public-radius-sm;
  }

  .image-vignette {
    border-radius: $public-radius-sm;
  }

  // Gentle scale on card hover (parent applies hover)
  &:hover .image-content {
    transform: scale(1.03);
    transition: transform $public-duration-slow $public-ease-out;
  }
}

// ================================================================
// CONTEXT: HERO IMAGE
// ================================================================
// Standard hero for event instance pages.

.context-hero {
  aspect-ratio: 16 / 9;
  border-radius: $public-radius-lg;
  box-shadow: $public-shadow-md-light;
  max-height: 400px;

  @include public-dark-mode {
    box-shadow: $public-shadow-md-dark;
  }

  .image-content {
    border-radius: $public-radius-lg;
  }

  .image-vignette {
    border-radius: $public-radius-lg;
    box-shadow: inset 0 0 60px rgba(0, 0, 0, 0.08);

    @include public-dark-mode {
      box-shadow: inset 0 0 60px rgba(0, 0, 0, 0.2);
    }
  }

  @include public-mobile-only {
    max-height: 240px;
  }
}

// ================================================================
// CONTEXT: FEATURE IMAGE
// ================================================================
// Dramatic ultrawide for event detail pages.

.context-feature {
  aspect-ratio: 2 / 1;
  border-radius: $public-radius-xl;
  box-shadow: $public-shadow-lg-light;
  max-height: 480px;

  @include public-dark-mode {
    box-shadow: $public-shadow-lg-dark;
  }

  .image-content {
    border-radius: $public-radius-xl;
  }

  .image-vignette {
    border-radius: $public-radius-xl;
    box-shadow: inset 0 0 100px rgba(0, 0, 0, 0.1);

    @include public-dark-mode {
      box-shadow: inset 0 0 100px rgba(0, 0, 0, 0.25);
    }
  }

  @include public-mobile-only {
    aspect-ratio: 16 / 9;
    max-height: 280px;
    border-radius: $public-radius-lg;

    .image-content,
    .image-vignette {
      border-radius: $public-radius-lg;
    }
  }
}

// ================================================================
// LOADING STATE
// ================================================================
// Minimal, subtle pulse instead of a skeleton

.image-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;

  .loading-pulse {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: linear-gradient(
      135deg,
      rgba(0, 0, 0, 0.06) 0%,
      rgba(0, 0, 0, 0.02) 100%
    );
    animation: gentle-pulse 1.8s ease-in-out infinite;

    @include public-dark-mode {
      background: linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.08) 0%,
        rgba(255, 255, 255, 0.03) 100%
      );
    }
  }
}

@keyframes gentle-pulse {
  0%, 100% {
    opacity: 0.4;
    transform: scale(0.9);
  }
  50% {
    opacity: 0.7;
    transform: scale(1);
  }
}
</style>
