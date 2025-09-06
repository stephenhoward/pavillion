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
@use '@/client/assets/mixins' as *;

.bulk-operations-menu {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--background-color, white);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 12px;
  padding: 16px 24px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  gap: 20px;
  z-index: 1000;
  transition: all 0.3s ease;
  max-width: 90vw;

  @include dark-mode {
    background: var(--background-secondary-dark, #2d3748);
    border-color: var(--border-color-dark, #4a5568);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  &.hidden {
    opacity: 0;
    visibility: hidden;
    transform: translateX(-50%) translateY(20px);
  }

  .selection-info {
    display: flex;
    align-items: center;

    .selection-count {
      font-weight: 500;
      color: var(--text-primary, #333);

      @include dark-mode {
        color: var(--text-primary-dark, #fff);
      }
    }
  }

  .bulk-actions {
    display: flex;
    gap: 12px;
    align-items: center;

    button {
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s ease;
      white-space: nowrap;

      &.secondary {
        background: var(--primary-color, #007bff);
        color: white;
        border: none;

        &:hover {
          background: var(--primary-color-dark, #0056b3);
        }

      }

      &.danger {
        background: var(--danger-color, #dc3545);
        color: white;
        border: none;

        &:hover {
          background: var(--danger-color-dark, #c82333);
        }
      }

      &.tertiary {
        background: transparent;
        color: var(--text-secondary, #666);
        border: 1px solid var(--border-color, #e0e0e0);

        &:hover {
          background: var(--background-secondary, #f8f9fa);
          color: var(--text-primary, #333);
        }

        @include dark-mode {
          color: var(--text-secondary-dark, #ccc);
          border-color: var(--border-color-dark, #4a5568);

          &:hover {
            background: var(--background-secondary-dark, #2d3748);
            color: var(--text-primary-dark, #fff);
          }
        }
      }
    }
  }

  // Responsive design for smaller screens
  @media (max-width: 768px) {
    flex-direction: column;
    gap: 12px;
    padding: 16px;

    .bulk-actions {
      width: 100%;
      justify-content: center;
    }
  }
}
</style>
