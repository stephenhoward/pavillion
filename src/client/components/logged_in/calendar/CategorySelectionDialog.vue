<script setup>
import { ref, computed, onMounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import CalendarService from '@/client/service/calendar';
import { useEventStore } from '@/client/stores/eventStore';

const { t } = useTranslation('calendars', {
  keyPrefix: 'bulk_operations',
});

const props = defineProps({
  visible: {
    type: Boolean,
    required: true,
  },
  selectedEventIds: {
    type: Array,
    required: true,
  },
});

const emit = defineEmits(['close', 'assign-complete']);

const eventStore = useEventStore();
const calendarService = new CalendarService();
const selectedCategoryIds = ref([]);
const isLoading = ref(false);
const errorMessage = ref('');

// Get available categories from the current calendar
const availableCategories = computed(() => {
  if (!eventStore.categories) return [];
  return eventStore.categories;
});

const isFormValid = computed(() => {
  return selectedCategoryIds.value.length > 0;
});

const handleClose = () => {
  selectedCategoryIds.value = [];
  errorMessage.value = '';
  emit('close');
};

const handleAssignCategories = async () => {
  if (!isFormValid.value) {
    errorMessage.value = t('select_categories_required');
    return;
  }

  isLoading.value = true;
  errorMessage.value = '';

  try {
    const updatedEvents = await calendarService.bulkAssignCategories(
      props.selectedEventIds,
      selectedCategoryIds.value,
    );

    // Update the event store with updated events
    updatedEvents.forEach(event => {
      eventStore.updateEvent(event);
    });

    emit('assign-complete', {
      eventCount: props.selectedEventIds.length,
      categoryCount: selectedCategoryIds.value.length,
    });

    handleClose();
  }
  catch (error) {
    console.error('Error assigning categories:', error);
    if (error.name === 'BulkEventsNotFoundError') {
      errorMessage.value = t('events_not_found');
    }
    else if (error.name === 'CategoriesNotFoundError') {
      errorMessage.value = t('categories_not_found');
    }
    else if (error.name === 'MixedCalendarEventsError') {
      errorMessage.value = t('mixed_calendar_events');
    }
    else if (error.name === 'InsufficientCalendarPermissionsError') {
      errorMessage.value = t('insufficient_permissions');
    }
    else {
      errorMessage.value = t('assignment_failed');
    }
  }
  finally {
    isLoading.value = false;
  }
};

const toggleCategory = (categoryId) => {
  const index = selectedCategoryIds.value.indexOf(categoryId);
  if (index === -1) {
    selectedCategoryIds.value.push(categoryId);
  }
  else {
    selectedCategoryIds.value.splice(index, 1);
  }
};
</script>

<template>
  <div v-if="visible" class="dialog-overlay" @click="handleClose">
    <div class="dialog" @click.stop>
      <header class="dialog-header">
        <h2>{{ t('assign_categories_dialog_title') }}</h2>
        <button
          type="button"
          class="close-button"
          @click="handleClose"
          :aria-label="t('close_dialog')"
        >
          ×
        </button>
      </header>

      <div class="dialog-body">
        <p class="selection-summary">
          {{ t('assign_categories_summary', { count: selectedEventIds.length }) }}
        </p>

        <div v-if="errorMessage" class="error-message" role="alert">
          {{ errorMessage }}
        </div>

        <div class="category-selection">
          <h3>{{ t('select_categories_label') }}</h3>

          <div v-if="availableCategories.length === 0" class="no-categories">
            {{ t('no_categories_available') }}
          </div>

          <div v-else class="category-list">
            <label
              v-for="category in availableCategories"
              :key="category.id"
              class="category-option"
            >
              <input
                type="checkbox"
                :value="category.id"
                :checked="selectedCategoryIds.includes(category.id)"
                @change="toggleCategory(category.id)"
              />
              <span class="category-name">{{ category.content('en').name }}</span>
            </label>
          </div>
        </div>
      </div>

      <footer class="dialog-footer">
        <button
          type="button"
          class="tertiary"
          @click="handleClose"
          :disabled="isLoading"
        >
          {{ t('cancel') }}
        </button>
        <button
          type="button"
          class="primary"
          @click="handleAssignCategories"
          :disabled="!isFormValid || isLoading"
        >
          <span v-if="isLoading">{{ t('assigning') }}</span>
          <span v-else>{{ t('assign_categories') }}</span>
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/client/assets/mixins' as *;

.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.dialog {
  background: var(--background-color, white);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  max-width: 500px;
  width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;

  @include dark-mode {
    background: var(--background-secondary-dark, #2d3748);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);

  @include dark-mode {
    border-color: var(--border-color-dark, #4a5568);
  }

  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 500;
    color: var(--text-primary, #333);

    @include dark-mode {
      color: var(--text-primary-dark, #fff);
    }
  }

  .close-button {
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    padding: 4px 8px;
    color: var(--text-secondary, #666);
    border-radius: 4px;

    &:hover {
      background: var(--background-secondary, #f8f9fa);
      color: var(--text-primary, #333);
    }

    @include dark-mode {
      color: var(--text-secondary-dark, #ccc);

      &:hover {
        background: var(--background-secondary-dark, #2d3748);
        color: var(--text-primary-dark, #fff);
      }
    }
  }
}

.dialog-body {
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;

  .selection-summary {
    margin: 0 0 20px 0;
    color: var(--text-secondary, #666);
    font-size: 14px;

    @include dark-mode {
      color: var(--text-secondary-dark, #ccc);
    }
  }

  .error-message {
    background: #fee;
    border: 1px solid #fcc;
    color: #c33;
    padding: 12px 16px;
    border-radius: 6px;
    margin-bottom: 20px;
    font-size: 14px;

    @include dark-mode {
      background: rgba(239, 68, 68, 0.1);
      border-color: rgba(239, 68, 68, 0.3);
      color: #ef4444;
    }
  }

  .category-selection {
    h3 {
      margin: 0 0 16px 0;
      font-size: 16px;
      font-weight: 500;
      color: var(--text-primary, #333);

      @include dark-mode {
        color: var(--text-primary-dark, #fff);
      }
    }

    .no-categories {
      padding: 20px;
      text-align: center;
      color: var(--text-secondary, #666);
      font-style: italic;

      @include dark-mode {
        color: var(--text-secondary-dark, #ccc);
      }
    }

    .category-list {
      display: flex;
      flex-direction: column;
      gap: 8px;

      .category-option {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        border: 1px solid var(--border-color, #e0e0e0);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s ease;

        &:hover {
          background: var(--background-secondary, #f8f9fa);
          border-color: var(--primary-color, #007bff);
        }

        @include dark-mode {
          border-color: var(--border-color-dark, #4a5568);

          &:hover {
            background: var(--background-secondary-dark, #2d3748);
            border-color: var(--primary-color, #007bff);
          }
        }

        input[type="checkbox"] {
          width: 18px;
          height: 18px;
          cursor: pointer;
        }

        .category-name {
          flex: 1;
          font-weight: 500;
          color: var(--text-primary, #333);
          user-select: none;

          @include dark-mode {
            color: var(--text-primary-dark, #fff);
          }
        }
      }
    }
  }
}

.dialog-footer {
  padding: 16px 24px 20px;
  border-top: 1px solid var(--border-color, #e0e0e0);
  display: flex;
  gap: 12px;
  justify-content: flex-end;

  @include dark-mode {
    border-color: var(--border-color-dark, #4a5568);
  }

  button {
    padding: 10px 20px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;

    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    &.tertiary {
      background: transparent;
      color: var(--text-secondary, #666);
      border: 1px solid var(--border-color, #e0e0e0);

      &:hover:not(:disabled) {
        background: var(--background-secondary, #f8f9fa);
        color: var(--text-primary, #333);
      }

      @include dark-mode {
        color: var(--text-secondary-dark, #ccc);
        border-color: var(--border-color-dark, #4a5568);

        &:hover:not(:disabled) {
          background: var(--background-secondary-dark, #2d3748);
          color: var(--text-primary-dark, #fff);
        }
      }
    }

    &.primary {
      background: var(--primary-color, #007bff);
      color: white;
      border: none;

      &:hover:not(:disabled) {
        background: var(--primary-color-dark, #0056b3);
      }
    }
  }
}
</style>
