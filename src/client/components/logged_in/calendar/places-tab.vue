<script setup>
import { reactive, ref, onMounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { Plus, Pencil, Trash2, MapPin } from 'lucide-vue-next';
import LocationService from '@/client/service/location';
import ModalLayout from '@/client/components/common/modal.vue';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import LoadingMessage from '@/client/components/common/loading_message.vue';
import PillButton from '@/client/components/common/pill-button.vue';
import { useToast } from '@/client/composables/useToast';

const props = defineProps({
  calendarId: {
    type: String,
    required: true,
  },
  calendarUrlName: {
    type: String,
    required: true,
  },
});

const { t } = useTranslation('calendars', {
  keyPrefix: 'places',
});

const router = useRouter();
const toast = useToast();
const locationService = new LocationService();

const addPlaceButtonRef = ref(null);
const emptyAddPlaceButtonRef = ref(null);

const state = reactive({
  locations: [],
  isLoading: false,
  error: '',

  // Delete dialog state
  showDeleteDialog: false,
  locationToDelete: null,
  isDeleting: '',

  // Focus management
  triggerElement: null,
});

/**
 * Load all locations for the calendar
 */
async function loadLocations() {
  state.isLoading = true;
  state.error = '';

  try {
    state.locations = await locationService.getLocations(props.calendarId);
  }
  catch (error) {
    console.error('Error loading locations:', error);
    state.error = t('error_loading');
  }
  finally {
    state.isLoading = false;
  }
}

/**
 * Navigate to create new place route
 */
function navigateToCreate() {
  router.push({
    name: 'place_new',
    params: { calendar: props.calendarUrlName },
  });
}

/**
 * Navigate to edit place route
 */
function navigateToEdit(location) {
  router.push({
    name: 'place_edit',
    params: {
      calendar: props.calendarUrlName,
      placeId: location.id,
    },
  });
}

/**
 * Format the address for display
 */
function formatAddress(location) {
  const parts = [location.address, location.city, location.state, location.postalCode].filter(Boolean);
  return parts.join(', ');
}

/**
 * Open delete confirmation dialog
 */
function confirmDelete(location, event) {
  state.triggerElement = event?.currentTarget ?? null;
  state.locationToDelete = location;
  state.showDeleteDialog = true;
}

/**
 * Cancel delete dialog
 */
function cancelDelete() {
  const trigger = state.triggerElement;
  state.locationToDelete = null;
  state.showDeleteDialog = false;
  state.isDeleting = '';
  state.triggerElement = null;
  nextTick(() => trigger?.focus());
}

/**
 * Delete the location
 */
async function deleteLocation() {
  if (!state.locationToDelete) {
    return;
  }

  state.isDeleting = state.locationToDelete.id;
  state.error = '';

  try {
    await locationService.deleteLocation(props.calendarId, state.locationToDelete.id);
    await loadLocations();

    // If the list is now empty, clear the trigger so cancelDelete
    // doesn't try to focus a removed button
    if (state.locations.length === 0) {
      state.triggerElement = null;
    }

    cancelDelete();
    toast.success(t('place_deleted_success'));

    // If the list is empty after deletion, focus the "Add Place" button
    if (state.locations.length === 0) {
      nextTick(() => {
        const btn = emptyAddPlaceButtonRef.value?.$el ?? emptyAddPlaceButtonRef.value;
        btn?.focus();
      });
    }
  }
  catch (error) {
    console.error('Error deleting location:', error);
    toast.error(t('error_deleting'));
  }
  finally {
    state.isDeleting = '';
  }
}

// Load locations when component mounts
onMounted(async () => {
  await loadLocations();
});
</script>

<template>
  <div class="vstack stack--lg" :aria-busy="state.isLoading ? 'true': 'false'">

    <!-- Error Display -->
    <div
      v-if="state.error"
      class="alert alert--error"
      role="alert"
      aria-live="polite"
    >
      {{ state.error }}
    </div>

    <LoadingMessage v-if="state.isLoading" :description="t('loading')" />

    <!-- Places List -->
    <div v-else-if="state.locations.length > 0" class="places-content">
      <div class="places-header">
        <h2 class="places-title">{{ t('title') }}</h2>
        <PillButton
          ref="addPlaceButtonRef"
          variant="primary"
          @click="navigateToCreate"
        >
          <Plus :size="20" :stroke-width="2" />
          {{ t('add_place_button') }}
        </PillButton>
      </div>

      <div class="places-list">
        <div
          v-for="location in state.locations"
          :key="location.id"
          class="place-card"
        >
          <div class="place-icon">
            <MapPin :size="20" :stroke-width="2" />
          </div>

          <div class="place-info">
            <div class="place-name">
              {{ location.name || t('unnamed_place') }}
            </div>
            <div v-if="formatAddress(location)" class="place-meta">
              <span class="place-address">{{ formatAddress(location) }}</span>
            </div>
            <div v-if="location.eventCount !== undefined" class="place-meta">
              <span class="event-count">{{ t('event_count', { count: location.eventCount || 0 }) }}</span>
            </div>
          </div>

          <div class="place-actions">
            <button
              type="button"
              class="icon-button"
              @click="navigateToEdit(location)"
              :disabled="state.isDeleting === location.id"
              :aria-label="t('edit_place_button', { name: location.name || t('unnamed_place') })"
            >
              <Pencil :size="20" :stroke-width="2" />
            </button>
            <button
              type="button"
              class="icon-button icon-button--danger"
              @click="confirmDelete(location, $event)"
              :disabled="state.isDeleting === location.id"
              :aria-label="t('delete_place_button', { name: location.name || t('unnamed_place') })"
            >
              <Trash2 :size="20" :stroke-width="2" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <EmptyLayout v-else :title="t('no_places')" :description="t('no_places_description')">
      <PillButton
        ref="emptyAddPlaceButtonRef"
        variant="primary"
        @click="navigateToCreate"
        :disabled="state.isLoading"
      >
        <Plus :size="20" :stroke-width="2" />
        {{ t('add_place_button') }}
      </PillButton>
    </EmptyLayout>

    <!-- Delete Confirmation Modal -->
    <ModalLayout
      v-if="state.showDeleteDialog && state.locationToDelete"
      :title="t('confirm_delete_title')"
      modal-class="delete-place-modal"
      @close="cancelDelete"
    >
      <div class="delete-dialog">
        <p class="delete-description">
          {{ t('confirm_delete_message', { name: state.locationToDelete.name || t('unnamed_place') }) }}
          <span v-if="(state.locationToDelete.eventCount || 0) > 0">
            {{ t('confirm_delete_event_count', { count: state.locationToDelete.eventCount }) }}
          </span>
        </p>

        <div class="delete-actions">
          <button
            type="button"
            class="btn-ghost"
            @click="cancelDelete"
            :disabled="state.isDeleting === state.locationToDelete?.id"
          >
            {{ t('cancel') }}
          </button>
          <PillButton
            variant="danger"
            @click="deleteLocation"
            :disabled="state.isDeleting === state.locationToDelete?.id"
          >
            {{ state.isDeleting === state.locationToDelete?.id ? t('deleting') : t('delete_button') }}
          </PillButton>
        </div>
      </div>
    </ModalLayout>
  </div>
</template>

<style scoped lang="scss">
@use '../../../assets/style/components/calendar-admin' as *;

.places-content {
  @include admin-section;
}

.places-header {
  @include admin-section-header;
}

.places-title {
  @include admin-section-title;
}

.places-list {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-3);
}

.place-card {
  @include admin-card;

  &:hover {
    border-color: var(--pav-color-stone-300);

    @media (prefers-color-scheme: dark) {
      border-color: var(--pav-color-stone-600);
    }
  }
}

.place-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--pav-color-stone-400);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-500);
  }
}

.place-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-2);
}

.place-name {
  font-weight: 500;
  font-size: 1rem;
  color: var(--pav-color-stone-900);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-100);
  }
}

.place-meta {
  display: flex;
  align-items: center;
  gap: var(--pav-space-3);
  font-size: 0.875rem;
  color: var(--pav-color-stone-600);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.place-address {
  color: var(--pav-color-stone-600);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.event-count {
  color: var(--pav-color-stone-600);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.place-actions {
  display: flex;
  gap: var(--pav-space-2);
  align-items: center;
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--pav-space-2);
  background: none;
  border: none;
  border-radius: 0.375rem;
  color: var(--pav-color-stone-500);
  cursor: pointer;
  transition: color 0.2s, background-color 0.2s;

  &:hover {
    color: var(--pav-color-orange-600);
    background: var(--pav-color-stone-100);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-orange-400);
      background: var(--pav-color-stone-800);
    }
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &--danger:hover {
    color: var(--pav-color-red-600);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-red-400);
    }
  }
}

// Constrain modal width
:global(.delete-place-modal > div) {
  max-width: 500px !important;
}

.delete-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);

  .delete-description {
    margin: 0;
    color: var(--pav-color-stone-600);
    font-size: 0.875rem;
    line-height: 1.5;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  .delete-actions {
    display: flex;
    gap: var(--pav-space-3);
    justify-content: flex-end;
    padding-top: var(--pav-space-4);
    border-top: 1px solid var(--pav-border-primary);
  }

  .btn-ghost {
    padding: var(--pav-space-2) var(--pav-space-4);
    background: none;
    border: none;
    color: var(--pav-color-stone-600);
    font-weight: 500;
    cursor: pointer;
    transition: color 0.2s;

    &:hover {
      color: var(--pav-color-stone-900);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-stone-100);
      }
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
}

.alert {
  padding: var(--pav-space-3);
  margin-bottom: var(--pav-space-4);
  border-radius: 0.75rem;
  font-size: 0.875rem;

  &.alert--error {
    background-color: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    color: var(--pav-color-red-700);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-red-400);
    }
  }
}
</style>
