<script setup>
import { ref, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import CalendarService from '@/client/service/calendar';
import { useEventStore } from '@/client/stores/eventStore';
import { useCategoryStore } from '@/client/stores/categoryStore';
import PillButton from '@/client/components/common/pill-button.vue';
import ToggleChip from '@/client/components/common/toggle-chip.vue';
import Sheet from '@/client/components/common/sheet.vue';

const { t, i18next } = useTranslation('calendars', {
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
  calendarId: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(['close', 'assign-complete']);

const eventStore = useEventStore();
const categoryStore = useCategoryStore();
const calendarService = new CalendarService();
const selectedCategoryIds = ref([]);
const isLoading = ref(false);
const errorMessage = ref('');

// Get available categories using the calendarId prop, which matches the key
// used by CategoryService.loadCategories to store categories in the store
const availableCategories = computed(() => {
  if (!props.calendarId) return [];
  return categoryStore.categories[props.calendarId] || [];
});

// Resolves a category's display name in the current locale, falling back to
// English and then to whichever language the category has.
const categoryName = (category) => {
  const language = i18next.language;
  if (language && category.hasContent(language)) {
    return category.content(language).name;
  }
  if (category.hasContent('en')) {
    return category.content('en').name;
  }
  return category.displayName();
};

// The events being assigned to, read from the store the list already loaded.
const selectedEvents = computed(() => {
  return eventStore.eventsForCalendar(props.calendarId)
    .filter(event => props.selectedEventIds.includes(event.id));
});

// How many of the selected events already carry each category.
const carriedByCount = (category) => {
  return selectedEvents.value
    .filter(event => event.categories.some(c => c.id === category.id)).length;
};

const isOnAllEvents = (category) => {
  return selectedEvents.value.length > 0 && carriedByCount(category) === selectedEvents.value.length;
};

const categoriesOnAll = computed(() => availableCategories.value.filter(isOnAllEvents));

const categoriesOnSome = computed(() => {
  return availableCategories.value.filter(category => {
    const count = carriedByCount(category);
    return count > 0 && count < selectedEvents.value.length;
  });
});

const namesOf = (categories) => categories.map(categoryName).join(', ');

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
      eventStore.updateEvent(event.calendarId, event);
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
  <Sheet
    v-if="visible"
    :title="t('assign_categories_dialog_title')"
    @close="handleClose"
  >
    <div class="category-selection-body">
      <p class="selection-summary">
        {{ t('assign_categories_summary', { count: selectedEventIds.length }) }}
      </p>

      <p class="assign-note">
        {{ t('assign_categories_adds_only') }}
      </p>

      <p v-if="categoriesOnAll.length" class="already-assigned" data-testid="already-on-all">
        {{ t('already_on_all', { names: namesOf(categoriesOnAll) }) }}
      </p>

      <p v-if="categoriesOnSome.length" class="already-assigned" data-testid="already-on-some">
        {{ t('already_on_some', { names: namesOf(categoriesOnSome) }) }}
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
            :model-value="isOnAllEvents(category) || selectedCategoryIds.includes(category.id)"
            :disabled="isOnAllEvents(category)"
            :label="categoryName(category)"
            variant="orange"
            @update:model-value="() => toggleCategory(category.id)"
          />
        </div>
      </div>

      <footer class="category-footer">
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
  </Sheet>
</template>

<style scoped lang="scss">
@use '@/client/assets/style/components/event-management' as *;
@use '@/client/assets/style/tokens/breakpoint-mixins' as *;

.category-selection-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.selection-summary,
.assign-note,
.already-assigned {
  margin: 0;
  color: var(--pav-color-stone-600);
  font-size: 0.875rem;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.error-message {
  padding: 1rem;
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

    @include pav-media-down(md) {
      grid-template-columns: 1fr;
    }
  }
}

.category-footer {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  padding-top: 1rem;
  border-top: 1px solid var(--pav-color-stone-200);

  @media (prefers-color-scheme: dark) {
    border-top-color: var(--pav-color-stone-700);
  }
}
</style>
