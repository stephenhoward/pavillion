<script setup>
import { reactive, ref, computed, onMounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { Plus, Pencil, Trash2, MapPin } from 'lucide-vue-next';
import LocationService from '@/client/service/location';
import ConfirmDeleteDialog from '@/client/components/common/confirm-delete-dialog.vue';
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

const deleteMessage = computed(() => {
  if (!state.locationToDelete) return '';
  const name = state.locationToDelete.name || t('unnamed_place');
  let msg = t('confirm_delete_message', { name });
  if ((state.locationToDelete.eventCount || 0) > 0) {
    msg += ' ' + t('confirm_delete_event_count', { count: state.locationToDelete.eventCount });
  }
  return msg;
});

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
  <div class="vstack stack--lg" :aria-busy="state.isLoading">

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
      <div class="tab-header">
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
            <MapPin :size="20" :stroke-width="2" aria-hidden="true" />
          </div>

          <div class="place-info">
            <div class="place-info__name">
              {{ location.name || t('unnamed_place') }}
            </div>
            <div v-if="formatAddress(location)" class="place-info__meta">
              <span>{{ formatAddress(location) }}</span>
            </div>
            <div v-if="location.eventCount !== undefined" class="place-info__meta">
              <span>{{ t('event_count', { count: location.eventCount || 0 }) }}</span>
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
    <ConfirmDeleteDialog
      :visible="state.showDeleteDialog && !!state.locationToDelete"
      :title="t('confirm_delete_title')"
      :message="deleteMessage"
      :is-deleting="state.isDeleting === state.locationToDelete?.id"
      :delete-label="t('delete_button')"
      :deleting-label="t('deleting')"
      :cancel-label="t('cancel')"
      modal-class="delete-place-modal"
      @confirm="deleteLocation"
      @close="cancelDelete"
    />
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
  @include admin-item-list;
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
  @include admin-item-info;
}

.place-actions {
  @include admin-item-actions;
}

.icon-button {
  @include admin-icon-button;

  &--danger {
    @include admin-icon-button--danger;
  }
}

// Constrain modal width
:global(.delete-place-modal > div) {
  max-width: 500px !important;
}

.alert {
  @include admin-alert;
}
</style>
