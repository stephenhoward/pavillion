<template>
  <div
    class="event-image"
    :class="[
      `context-${context}`,
      { 'is-loading': isLoading, 'has-error': imageError, 'no-image': !media }
    ]"
  >
    <!-- Loading skeleton -->
    <div
      v-if="isLoading && media"
      class="image-skeleton"
    >
      <div class="skeleton-shimmer" />
    </div>

    <!-- Actual image -->
    <img
      v-if="media && !imageError"
      :src="imageUrl"
      :alt="media.originalFilename || 'Event image'"
      :loading="lazy ? 'lazy' : 'eager'"
      @load="handleImageLoad"
      @error="handleImageError"
      class="image-content"
    />

    <!-- Placeholder for missing/failed images -->
    <div
      v-if="!media || imageError"
      class="image-placeholder"
    >
      <svg
        class="placeholder-icon"
        viewBox="0 0 48 48"
        fill="none"
      >
        <rect
          x="6"
          y="10"
          width="36"
          height="28"
          rx="4"
          stroke="currentColor"
          stroke-width="2"
        />
        <circle
          cx="16"
          cy="20"
          r="4"
          stroke="currentColor"
          stroke-width="2"
        />
        <path
          d="M6 32L16 24L24 30L36 20L42 26"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>

    <!-- Optional overlay gradient for text readability (card context) -->
    <div
      v-if="context === 'card' && showOverlay"
      class="image-overlay"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

interface MediaObject {
  id: string;
  originalFilename?: string;
}

const props = defineProps<{
  media: MediaObject | null;
  context?: 'card' | 'hero' | 'feature';
  lazy?: boolean;
  showOverlay?: boolean;
}>();

const isLoading = ref(true);
const imageError = ref(false);

const imageUrl = computed(() => {
  if (!props.media) return '';
  return `/api/v1/media/${props.media.id}`;
});

const handleImageLoad = () => {
  isLoading.value = false;
};

const handleImageError = () => {
  isLoading.value = false;
  imageError.value = true;
};
</script>

<style scoped lang="scss">
@use '../assets/mixins' as *;

// ================================================================
// EVENT IMAGE COMPONENT
// ================================================================
// A sophisticated image container with fixed aspect ratios,
// loading states, and context-aware styling.
//
// Contexts:
//   - card: Compact thumbnail for event list cards (4:3)
//   - hero: Standard hero image for instance pages (16:9)
//   - feature: Dramatic cinematic image for detail pages (2:1)
// ================================================================

.event-image {
  position: relative;
  width: 100%;
  overflow: hidden;
  background-color: $public-bg-tertiary-light;
  border-radius: $public-radius-md;
  transition: $public-transition-normal;

  @include public-dark-mode {
    background-color: $public-bg-tertiary-dark;
  }

  // Shared image styling
  .image-content {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    transition: opacity $public-duration-slow $public-ease-out,
                transform $public-duration-slow $public-ease-out;
  }

  // Hide image while loading
  &.is-loading .image-content {
    opacity: 0;
  }
}

// ================================================================
// CONTEXT: CARD THUMBNAIL
// ================================================================
// Compact 4:3 aspect ratio for event list cards.
// Optimized for ~150px card width.

.context-card {
  aspect-ratio: 4 / 3;
  border-radius: $public-radius-sm;
  box-shadow: $public-shadow-xs-light;

  @include public-dark-mode {
    box-shadow: $public-shadow-xs-dark;
  }

  .image-content {
    border-radius: $public-radius-sm;
  }

  // Subtle hover effect on parent card
  &:hover .image-content {
    transform: scale(1.03);
  }

  // Gradient overlay for potential text overlay
  .image-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to top,
      rgba(0, 0, 0, 0.4) 0%,
      rgba(0, 0, 0, 0) 50%
    );
    pointer-events: none;
    border-radius: $public-radius-sm;
  }
}

// ================================================================
// CONTEXT: HERO IMAGE
// ================================================================
// Standard 16:9 hero format for event instance pages.
// Creates atmosphere without overwhelming content.

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

  // Subtle vignette for depth
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: $public-radius-lg;
    box-shadow: inset 0 0 60px rgba(0, 0, 0, 0.08);
    pointer-events: none;

    @include public-dark-mode {
      box-shadow: inset 0 0 60px rgba(0, 0, 0, 0.2);
    }
  }

  // On mobile, reduce max height
  @include public-mobile-only {
    max-height: 240px;
  }
}

// ================================================================
// CONTEXT: FEATURE IMAGE
// ================================================================
// Dramatic 2:1 ultrawide for event detail pages.
// Most prominent presentation, creates immersion.

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

  // More dramatic vignette
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: $public-radius-xl;
    box-shadow: inset 0 0 100px rgba(0, 0, 0, 0.1);
    pointer-events: none;

    @include public-dark-mode {
      box-shadow: inset 0 0 100px rgba(0, 0, 0, 0.25);
    }
  }

  // On mobile, adjust to 16:9 for better proportions
  @include public-mobile-only {
    aspect-ratio: 16 / 9;
    max-height: 280px;
    border-radius: $public-radius-lg;

    .image-content,
    &::after {
      border-radius: $public-radius-lg;
    }
  }
}

// ================================================================
// LOADING SKELETON
// ================================================================

.image-skeleton {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    135deg,
    $public-bg-tertiary-light 0%,
    rgba(0, 0, 0, 0.06) 50%,
    $public-bg-tertiary-light 100%
  );
  overflow: hidden;

  @include public-dark-mode {
    background: linear-gradient(
      135deg,
      $public-bg-tertiary-dark 0%,
      rgba(255, 255, 255, 0.06) 50%,
      $public-bg-tertiary-dark 100%
    );
  }

  .skeleton-shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.3) 50%,
      transparent 100%
    );
    animation: shimmer 1.5s infinite;

    @include public-dark-mode {
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(255, 255, 255, 0.08) 50%,
        transparent 100%
      );
    }
  }
}

@keyframes shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

// ================================================================
// PLACEHOLDER (No image / Error state)
// ================================================================

.image-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(
    135deg,
    $public-bg-secondary-light 0%,
    $public-bg-tertiary-light 100%
  );

  @include public-dark-mode {
    background: linear-gradient(
      135deg,
      $public-bg-secondary-dark 0%,
      $public-bg-tertiary-dark 100%
    );
  }

  .placeholder-icon {
    width: 32%;
    max-width: 64px;
    height: auto;
    color: $public-text-tertiary-light;
    opacity: 0.6;

    @include public-dark-mode {
      color: $public-text-tertiary-dark;
    }
  }
}

// Context-specific placeholder sizing
.context-card .placeholder-icon {
  max-width: 40px;
}

.context-hero .placeholder-icon {
  max-width: 72px;
}

.context-feature .placeholder-icon {
  max-width: 96px;
}

// ================================================================
// NO IMAGE STATE
// ================================================================
// When no media is provided, show placeholder without skeleton

.no-image {
  .image-skeleton {
    display: none;
  }
}
</style>
