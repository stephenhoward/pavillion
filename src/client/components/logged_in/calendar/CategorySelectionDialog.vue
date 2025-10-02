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
const dialogTitleId = 'category-dialog-title';

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
  <div
    v-if="visible"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="dialogTitleId"
    @click.self="handleClose"
  >
    <header>
      <h2 :id="dialogTitleId">{{ t('assign_categories_dialog_title') }}</h2>
      <button
        type="button"
        class="close-button"
        @click="handleClose"
        :aria-label="t('close_dialog')"
      >
        ×
      </button>
    </header>

    <div class="dialog-content">
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

    <footer>
      <button
        type="button"
        class="btn-ghost"
        @click="handleClose"
        :disabled="isLoading"
      >
        {{ t('cancel') }}
      </button>
      <button
        type="button"
        class="btn-primary"
        @click="handleAssignCategories"
        :disabled="!isFormValid || isLoading"
      >
        <span v-if="isLoading">{{ t('assigning') }}</span>
        <span v-else>{{ t('assign_categories') }}</span>
      </button>
    </footer>
  </div>
</template>

<style scoped lang="scss">
@use '../../../assets/mixins' as *;

// Use existing dialog system from _dialogs.scss - minimal custom styling needed

.close-button {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  padding: 4px 8px;
  color: #666;
  border-radius: 4px;

  &:hover {
    background: rgba(0, 0, 0, 0.05);
    color: #333;
  }
}

.dialog-content {
  overflow-y: auto;
  flex: 1;
}

.selection-summary {
  margin: 0 0 20px 0;
  color: #666;
  font-size: 14px;
}

.error-message {
  @include error-message;
  margin-bottom: 20px;
}

.category-selection {
  h3 {
    margin: 0 0 16px 0;
    font-size: 16px;
    font-weight: 500;
  }

  .no-categories {
    @include loading-state;
    font-style: italic;
  }

  .category-list {
    @include vstack-gap($spacing-sm);

    .category-option {
      @include list-item-base;
      cursor: pointer;
      gap: 12px;

      &:hover {
        background: rgba(0, 123, 255, 0.05);
        border-color: #007bff;
      }

      input[type="checkbox"] {
        width: 18px;
        height: 18px;
        cursor: pointer;
      }

      .category-name {
        flex: 1;
        font-weight: 500;
        user-select: none;
      }
    }
  }
}

footer {
  button {
    &.btn-primary {
      @include btn-primary;
      @include btn-md;
    }

    &.btn-ghost {
      @include btn-ghost;
      @include btn-md;
    }
  }
}
</style>
