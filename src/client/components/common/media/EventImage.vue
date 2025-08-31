<template>
  <figure v-if="media" class="event-image" :class="size">
    <img
      :src="imageUrl"
      :alt="media.originalFilename || 'Event image'"
      @error="handleImageError"
      :class="{ 'image-error': imageError }"
      :aria-describedby="imageError ? `error-${media.id}` : null"
    />
    <figcaption v-if="imageError"
                :id="`error-${media.id}`"
                class="error-message"
                role="alert"
                aria-live="polite">
      {{ t('image_load_error') }}
    </figcaption>
    <figcaption v-else-if="media.originalFilename && media.originalFilename !== 'Event image'"
                class="image-caption">
      {{ media.originalFilename }}
    </figcaption>
  </figure>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useTranslation } from 'i18next-vue';

const { t } = useTranslation('event');

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

const imageUrl = computed(() => {
  if (!props.media) return '';
  return `/api/v1/media/${props.media.id}`;
});

const handleImageError = () => {
  imageError.value = true;
};
</script>

<style scoped lang="scss">
.event-image {
  margin: 10px 0;

  img {
    max-width: 100%;
    height: auto;
    border-radius: 6px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

    &.image-error {
      display: none;
    }

    @media (prefers-color-scheme: dark) {
      box-shadow: 0 2px 4px rgba(255, 255, 255, 0.1);
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
.event-image.small img {
  max-width: 200px;
}

.event-image.medium img {
  max-width: 400px;
}

.event-image.large img {
  max-width: 600px;
}
</style>
