<script setup>
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';

const { t } = useTranslation('calendars', {
  keyPrefix: 'bulk_operations',
});

const props = defineProps({
  selectedCount: {
    type: Number,
    required: true,
  },
});

const emit = defineEmits(['assign-categories', 'delete-events', 'deselect-all']);

const isVisible = computed(() => props.selectedCount > 0);

const selectionText = computed(() => {
  if (props.selectedCount === 1) {
    return t('event_selected', { count: props.selectedCount });
  }
  else {
    return t('events_selected', { count: props.selectedCount });
  }
});

const assignCategories = () => {
  emit('assign-categories');
};

const deselectAll = () => {
  emit('deselect-all');
};

const deleteEvents = () => {
  emit('delete-events');
};

</script>

<template>
  <div
    class="bulk-operations-menu"
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
        class="secondary"
        data-testid="assign-categories-btn"
        @click="assignCategories"
        :aria-label="t('assign_categories_label')"
      >
        {{ t('assign_categories') }}
      </button>

      <button
        type="button"
        class="danger"
        data-testid="delete-events-btn"
        @click="deleteEvents"
        :aria-label="t('delete_events_label')"
      >
        {{ t('delete_events') }}
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

.bulk-operations-menu {
  @include floating-container-bottom-center;
  @include floating-container-horizontal;

  .selection-info {
    @include floating-selection-info;
  }

  .bulk-actions {
    @include floating-actions-group;

    button {
      &.secondary {
        @include floating-btn-primary;
      }

      &.danger {
        @include floating-btn-danger;
      }

      &.tertiary {
        @include floating-btn-ghost;
      }
    }
  }
}
</style>
