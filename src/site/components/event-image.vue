<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';

interface MediaObject {
  id: string;
  originalFilename?: string;
}

const props = withDefaults(defineProps<{
  media: MediaObject | null;
  context?: 'card' | 'hero' | 'feature';
  lazy?: boolean;
  alt?: string;
  focalPointX?: number;
  focalPointY?: number;
  zoom?: number;
}>(), {
  focalPointX: 0.5,
  focalPointY: 0.5,
  zoom: 1.0,
});

const imageStyle = computed(() => {
  const style: Record<string, string> = {
    objectPosition: `${props.focalPointX * 100}% ${props.focalPointY * 100}%`,
  };
  if (props.zoom > 1) {
    const origin = `${props.focalPointX * 100}% ${props.focalPointY * 100}%`;
    style['--image-zoom'] = String(props.zoom);
    style.transform = `scale(${props.zoom})`;
    style.transformOrigin = origin;
  }
  return style;
});

const isLoading = ref(true);
const imageFailed = ref(false);
const imageBlobUrl = ref<string | null>(null);
const pollAttempt = ref(0);
const pollingTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

const maxPollAttempts = 4;

// Component only shows if media exists AND image hasn't failed
const shouldShow = computed(() => {
  return props.media && !imageFailed.value;
});

const imageUrl = computed(() => {
  if (!props.media) return '';
  return `/api/v1/media/${props.media.id}`;
});

// Progressive backoff delays: 1s, 2s, 4s, 8s
const getPollingDelay = (attempt: number): number => {
  const delays = [1000, 2000, 4000, 8000];
  return delays[Math.min(attempt, delays.length - 1)];
};

const fetchImage = async () => {
  if (!props.media) return;

  try {
    const response = await fetch(imageUrl.value);

    if (response.status === 202) {
      // Media is still processing - retry with backoff
      if (pollAttempt.value < maxPollAttempts) {
        const delay = getPollingDelay(pollAttempt.value);
        pollAttempt.value++;
        pollingTimeout.value = setTimeout(fetchImage, delay);
      }
      else {
        // Gave up polling - hide image
        imageFailed.value = true;
        isLoading.value = false;
      }
      return;
    }

    if (response.ok) {
      const blob = await response.blob();
      imageBlobUrl.value = URL.createObjectURL(blob);
      // Keep loading true until img onload fires
    }
    else {
      // Other error - gracefully hide
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
};

const handleImageError = () => {
  imageFailed.value = true;
  isLoading.value = false;
};

const cleanup = () => {
  if (pollingTimeout.value) {
    clearTimeout(pollingTimeout.value);
    pollingTimeout.value = null;
  }
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
    isLoading.value = true;
    pollAttempt.value = 0;
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
      v-if="imageBlobUrl"
      :src="imageBlobUrl"
      :alt="alt || media?.originalFilename || ''"
      :style="imageStyle"
      @load="handleImageLoad"
      @error="handleImageError"
      class="image-content"
    />

    <!-- Subtle vignette overlay for depth -->
    <div class="image-vignette" />
  </div>
</template>

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
// No aspect-ratio: the image fills its parent's height so the card
// layout (image column vs content column) cannot misalign. The parent
// `.card-image` wrapper in event-card.vue controls the dimensions.

.context-card {
  height: 100%;
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
  // Composes with zoom via --image-zoom custom property
  &:hover .image-content {
    transform: scale(calc(var(--image-zoom, 1) * 1.03)) !important;
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
