<script setup>
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';

const { t } = useTranslation('calendars', {
  keyPrefix: 'bulk_category_operations',
});

const props = defineProps({
  selectedCount: {
    type: Number,
    required: true,
  },
});

const emit = defineEmits(['merge-categories', 'deselect-all']);

const isVisible = computed(() => props.selectedCount >= 2);

const selectionText = computed(() => {
  if (props.selectedCount === 1) {
    return t('category_selected', { count: props.selectedCount });
  }
  else {
    return t('categories_selected', { count: props.selectedCount });
  }
});

const mergeCategories = () => {
  emit('merge-categories');
};

const deselectAll = () => {
  emit('deselect-all');
};

</script>

<template>
  <div
    class="bulk-categories-menu"
    :class="{ hidden: !isVisible }"
    role="toolbar"
    :aria-label="t('menu_label')"
  >
    <div class="selection-info">
      <span
        aria-live="polite"
        class="selection-count"
      >
        {{ selectionText }}
      </span>
    </div>

    <div class="bulk-actions">
      <button
        type="button"
        class="primary"
        data-testid="merge-categories-btn"
        @click="mergeCategories"
        :aria-label="t('merge_categories_label')"
      >
        {{ t('merge_categories') }}
      </button>

      <button
        type="button"
        class="tertiary"
        data-testid="deselect-all-btn"
        @click="deselectAll"
        :aria-label="t('deselect_all_label')"
      >
        {{ t('deselect_all') }}
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../../assets/mixins' as *;

.bulk-categories-menu {
  @include floating-container-bottom-center;
  @include floating-container-horizontal;

  .selection-info {
    @include floating-selection-info;
  }

  .bulk-actions {
    @include floating-actions-group;

    button {
      &.primary {
        @include floating-btn-primary;
      }

      &.tertiary {
        @include floating-btn-ghost;
      }
    }
  }
}
</style>
