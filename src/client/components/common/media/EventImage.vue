<template>
  <figure v-if="media" class="event-image" :class="size">
    <!-- Processing state - show placeholder -->
    <div
      v-if="isProcessing"
      class="processing-placeholder"
      role="status"
      aria-live="polite"
    >
      <div class="processing-icon">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <rect
            x="3"
            y="3"
            width="18"
            height="18"
            rx="2"
            ry="2"
          />
          <circle
            cx="8.5"
            cy="8.5"
            r="1.5"
          />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </div>
      <span class="processing-text">{{ t('display.processing_image') }}</span>
    </div>

    <!-- Loaded image -->
    <img
      v-else-if="!imageError && imageBlobUrl"
      :src="imageBlobUrl"
      :alt="media.originalFilename || 'Event image'"
      @error="handleImageError"
    />

    <!-- Error state -->
    <figcaption v-if="imageError && !isProcessing"
                :id="`error-${media.id}`"
                class="error-message"
                role="alert"
                aria-live="polite">
      {{ t('display.image_load_error') }}
    </figcaption>
    <figcaption v-else-if="!isProcessing && imageBlobUrl && media.originalFilename && media.originalFilename !== 'Event image'"
                class="image-caption">
      {{ media.originalFilename }}
    </figcaption>
  </figure>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useTranslation } from 'i18next-vue';

const { t } = useTranslation('media');

const props = defineProps({
  media: {
    type: Object,
    default: null,
  },
  size: {
    type: String,
    default: 'medium',
    validator: (value) => ['small', 'medium', 'large'].includes(value),
  },
});

const imageError = ref(false);
const isProcessing = ref(false);
const imageBlobUrl = ref(null);
const pollingTimeout = ref(null);
const pollAttempt = ref(0);

const imageUrl = computed(() => {
  if (!props.media) return '';
  return `/api/v1/media/${props.media.id}`;
});

// Progressive backoff delays: 1s, 2s, 4s, 8s, then stop
const getPollingDelay = (attempt) => {
  const delays = [1000, 2000, 4000, 8000];
  return delays[Math.min(attempt, delays.length - 1)];
};

const maxPollAttempts = 4;

const fetchImage = async () => {
  if (!props.media) return;

  try {
    const response = await fetch(imageUrl.value);

    if (response.status === 202) {
      // Media is still being processed
      isProcessing.value = true;
      imageError.value = false;

      // Schedule next poll with progressive backoff
      if (pollAttempt.value < maxPollAttempts) {
        const delay = getPollingDelay(pollAttempt.value);
        pollAttempt.value++;
        pollingTimeout.value = setTimeout(fetchImage, delay);
      }
      else {
        // Gave up polling - keep showing processing state
        console.warn(`Media ${props.media.id} still processing after ${maxPollAttempts} poll attempts`);
      }
      return;
    }

    if (response.ok) {
      // Image is ready - create blob URL
      isProcessing.value = false;
      const blob = await response.blob();
      imageBlobUrl.value = URL.createObjectURL(blob);
      pollAttempt.value = 0;
      return;
    }

    // Other error status
    isProcessing.value = false;
    imageError.value = true;
  }
  catch (error) {
    console.error('Error fetching image:', error);
    isProcessing.value = false;
    imageError.value = true;
  }
};

const handleImageError = () => {
  imageError.value = true;
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
    imageError.value = false;
    isProcessing.value = false;
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
});

onUnmounted(() => {
  cleanup();
});
</script>

<style scoped lang="scss">
.event-image {
  margin: 10px 0;

  img {
    max-width: 100%;
    height: auto;
    border-radius: 6px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

    @media (prefers-color-scheme: dark) {
      box-shadow: 0 2px 4px rgba(255, 255, 255, 0.1);
    }
  }

  .processing-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    background: linear-gradient(135deg, #f0f4f8 0%, #e2e8f0 100%);
    border-radius: 6px;
    border: 2px dashed #cbd5e0;

    @media (prefers-color-scheme: dark) {
      background: linear-gradient(135deg, #2d3748 0%, #1a202c 100%);
      border-color: #4a5568;
    }

    .processing-icon {
      width: 48px;
      height: 48px;
      color: #718096;
      margin-bottom: 12px;
      animation: pulse 2s ease-in-out infinite;

      @media (prefers-color-scheme: dark) {
        color: #a0aec0;
      }

      svg {
        width: 100%;
        height: 100%;
      }
    }

    .processing-text {
      font-size: 14px;
      color: #718096;
      font-weight: 500;

      @media (prefers-color-scheme: dark) {
        color: #a0aec0;
      }
    }
  }

  .error-message {
    padding: 10px;
    background: #f8d7da;
    color: #721c24;
    border: 1px solid #f5c6cb;
    border-radius: 6px;
    font-size: 14px;

    @media (prefers-color-scheme: dark) {
      background: #2d1b1e;
      color: #f8d7da;
      border-color: #721c24;
    }
  }
}

/* Size variants */
.event-image.small img,
.event-image.small .processing-placeholder {
  max-width: 200px;
}

.event-image.medium img,
.event-image.medium .processing-placeholder {
  max-width: 400px;
}

.event-image.large img,
.event-image.large .processing-placeholder {
  max-width: 600px;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>
