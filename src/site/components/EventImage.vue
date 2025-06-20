<template>
  <div v-if="media" class="event-image">
    <img
      :src="imageUrl"
      :alt="media.originalFilename"
      @error="handleImageError"
      :class="{ 'image-error': imageError }"
    />
    <div v-if="imageError" class="error-message">
      Image could not be loaded
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';

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
  }

  .error-message {
    padding: 10px;
    background: #f8d7da;
    color: #721c24;
    border: 1px solid #f5c6cb;
    border-radius: 6px;
    font-size: 14px;
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
