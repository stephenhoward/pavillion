<script setup>
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import PillButton from '@/client/components/common/PillButton.vue';

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
    v-if="isVisible"
    class="bulk-operations-menu"
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
      <PillButton
        type="button"
        variant="secondary"
        size="sm"
        class="assign-btn"
        data-testid="assign-categories-btn"
        @click="assignCategories"
        :aria-label="t('assign_categories_label')"
      >
        {{ t('assign_categories') }}
      </PillButton>

      <PillButton
        type="button"
        variant="secondary"
        size="sm"
        class="delete-btn"
        data-testid="delete-events-btn"
        @click="deleteEvents"
        :aria-label="t('delete_events_label')"
      >
        {{ t('delete_events') }}
      </PillButton>

      <PillButton
        type="button"
        variant="ghost"
        size="sm"
        data-testid="deselect-all-btn"
        @click="deselectAll"
        :aria-label="t('deselect_all_label')"
      >
        {{ t('deselect_all') }}
      </PillButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../../assets/style/components/event-management' as *;

.bulk-operations-menu {
  @include bulk-actions-bar;

  .selection-info {
    .selection-count {
      color: white;
      font-weight: 500;
      font-size: 0.9375rem;
    }
  }

  .bulk-actions {
    display: flex;
    gap: 0.75rem;
    align-items: center;

    // Sky-500 for assign categories button
    .assign-btn {
      background-color: var(--pav-color-sky-500);
      color: white;
      border-color: var(--pav-color-sky-500);

      &:hover {
        background-color: var(--pav-color-sky-600);
        border-color: var(--pav-color-sky-600);
      }
    }

    // Red-500 for delete events button
    .delete-btn {
      background-color: var(--pav-color-red-500);
      color: white;
      border-color: var(--pav-color-red-500);

      &:hover {
        background-color: var(--pav-color-red-600);
        border-color: var(--pav-color-red-600);
      }
    }
  }
}
</style>
