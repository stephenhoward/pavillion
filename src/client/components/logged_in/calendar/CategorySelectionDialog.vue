<script setup>
import { ref, computed, onMounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import { X } from 'lucide-vue-next';
import CalendarService from '@/client/service/calendar';
import { useEventStore } from '@/client/stores/eventStore';
import PillButton from '@/client/components/common/PillButton.vue';
import ToggleChip from '@/client/components/common/ToggleChip.vue';

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
        <X :size="20" aria-hidden="true" />
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
          <ToggleChip
            v-for="category in availableCategories"
            :key="category.id"
            :model-value="selectedCategoryIds.includes(category.id)"
            :label="category.content('en').name"
            @update:model-value="() => toggleCategory(category.id)"
          />
        </div>
      </div>
    </div>

    <footer>
      <PillButton
        variant="ghost"
        @click="handleClose"
        :disabled="isLoading"
      >
        {{ t('cancel') }}
      </PillButton>
      <PillButton
        variant="primary"
        @click="handleAssignCategories"
        :disabled="!isFormValid || isLoading"
      >
        <span v-if="isLoading">{{ t('assigning') }}</span>
        <span v-else>{{ t('assign_categories') }}</span>
      </PillButton>
    </footer>
  </div>
</template>

<style scoped lang="scss">
@use '@/client/assets/mixins' as *;
@use '@/client/assets/style/components/event-management' as *;

.close-button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.5rem;
  color: var(--pav-color-stone-600);
  border-radius: 0.5rem; // rounded-lg
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s, color 0.2s;

  &:hover {
    background-color: var(--pav-color-stone-100);
    color: var(--pav-color-stone-900);
  }

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);

    &:hover {
      background-color: var(--pav-color-stone-800);
      color: var(--pav-color-stone-100);
    }
  }
}

.dialog-content {
  overflow-y: auto;
  flex: 1;
}

.selection-summary {
  margin: 0 0 1.5rem 0;
  color: var(--pav-color-stone-600);
  font-size: 0.875rem;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.error-message {
  padding: 1rem;
  margin-bottom: 1.5rem;
  background-color: var(--pav-color-red-50);
  border: 1px solid var(--pav-color-red-200);
  border-radius: 0.75rem; // rounded-xl
  color: var(--pav-color-red-700);
  font-size: 0.875rem;

  @media (prefers-color-scheme: dark) {
    background-color: rgba(239, 68, 68, 0.1);
    border-color: var(--pav-color-red-900);
    color: var(--pav-color-red-300);
  }
}

.category-selection {
  h3 {
    @include section-label;
    margin: 0 0 1rem 0;
  }

  .no-categories {
    text-align: center;
    padding: 2rem 1rem;
    color: var(--pav-color-stone-500);
    font-size: 0.875rem;
    font-style: italic;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  .category-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 0.75rem;

    @media (max-width: 768px) {
      grid-template-columns: 1fr;
    }
  }
}

footer {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  padding-top: 1.5rem;
  border-top: 1px solid var(--pav-color-stone-200);

  @media (prefers-color-scheme: dark) {
    border-top-color: var(--pav-color-stone-700);
  }
}
</style>
