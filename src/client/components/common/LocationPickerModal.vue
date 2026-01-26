<script setup lang="ts">
import { ref, computed } from 'vue';
import { Search, MapPin, Check } from 'lucide-vue-next';
import PillButton from '@/client/components/common/PillButton.vue';
import type { EventLocation } from '@/common/model/location';

/**
 * LocationPickerModal Component
 *
 * Modal dialog for selecting a location from a list with search functionality.
 * Displays locations with MapPin icons and shows checkmark for selected location.
 *
 * Features:
 * - Real-time search filtering by name, address, city, state, or postal code
 * - Visual indication of currently selected location with orange checkmark
 * - Options to create new location or remove current selection
 * - Pill-shaped search input following design system
 *
 * @component
 *
 * Props:
 * @prop {EventLocation[]} locations - Array of available locations to choose from
 * @prop {string | null} selectedLocationId - ID of currently selected location, or null if none selected
 *
 * Emits:
 * @emits location-selected - Fired when user selects a location from the list
 *   @param {EventLocation} location - The selected location object
 * @emits create-new - Fired when user clicks "Create New Location" button
 * @emits remove-location - Fired when user clicks "Remove" button to clear location
 * @emits close - Fired when user closes the modal dialog
 */

const props = defineProps<{
  locations: EventLocation[];
  selectedLocationId: string | null;
}>();

const emit = defineEmits<{
  (e: 'location-selected', location: EventLocation): void;
  (e: 'create-new'): void;
  (e: 'remove-location'): void;
  (e: 'close'): void;
}>();

const dialogRef = ref<HTMLDialogElement | null>(null);
const searchQuery = ref('');

// Filter locations based on search query
const filteredLocations = computed(() => {
  if (!searchQuery.value.trim()) {
    return props.locations;
  }

  const query = searchQuery.value.toLowerCase();
  return props.locations.filter(location => {
    const searchableText = [
      location.name,
      location.address,
      location.city,
      location.state,
      location.postalCode,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return searchableText.includes(query);
  });
});

const hasLocations = computed(() => props.locations.length > 0);

const isSelected = (locationId: string) => {
  return locationId === props.selectedLocationId;
};

const formatAddress = (location: EventLocation) => {
  const parts = [
    location.address,
    location.city,
    location.state,
    location.postalCode,
  ].filter(Boolean);
  return parts.join(', ');
};

const handleLocationClick = (location: EventLocation) => {
  emit('location-selected', location);
};

const handleCreateNew = () => {
  emit('create-new');
};

const handleRemoveLocation = () => {
  emit('remove-location');
};

const close = () => {
  if (dialogRef.value) {
    dialogRef.value.close();
    emit('close');
  }
};

// Expose methods to parent
defineExpose({ close, dialogRef });
</script>

<template>
  <dialog
    ref="dialogRef"
    class="location-picker-modal"
    aria-labelledby="location-picker-title"
    aria-modal="true"
    @click.self="close"
  >
    <div class="modal-content">
      <!-- Header -->
      <header class="modal-header">
        <h2 id="location-picker-title">Select Location</h2>
        <button
          type="button"
          class="close-button"
          @click="close"
          aria-label="Close dialog"
        >
          &times;
        </button>
      </header>

      <!-- Search Input -->
      <div class="search-section">
        <div class="search-input-wrapper">
          <Search :size="20" class="search-icon" />
          <input
            v-model="searchQuery"
            type="text"
            class="search-input"
            placeholder="Search locations..."
            aria-label="Search locations"
          />
        </div>
      </div>

      <!-- Location List -->
      <div class="location-list-container">
        <div v-if="hasLocations && filteredLocations.length > 0" class="location-list">
          <div
            v-for="location in filteredLocations"
            :key="location.id"
            class="location-item"
            :class="{ selected: isSelected(location.id) }"
            role="button"
            tabindex="0"
            @click="handleLocationClick(location)"
            @keydown.enter="handleLocationClick(location)"
            @keydown.space.prevent="handleLocationClick(location)"
          >
            <MapPin :size="20" class="location-icon" />
            <div class="location-info">
              <div class="location-name">{{ location.name }}</div>
              <div v-if="formatAddress(location)" class="location-address">
                {{ formatAddress(location) }}
              </div>
            </div>
            <Check v-if="isSelected(location.id)" :size="20" class="checkmark" />
          </div>
        </div>

        <div v-else-if="!hasLocations" class="empty-state">
          <MapPin :size="48" class="empty-icon" />
          <p>No locations yet</p>
          <p class="empty-hint">Create your first location to get started</p>
        </div>

        <div v-else class="empty-state">
          <p>No locations match your search</p>
        </div>
      </div>

      <!-- Footer -->
      <footer class="modal-footer">
        <PillButton
          variant="ghost"
          size="sm"
          @click="handleRemoveLocation"
        >
          Remove location
        </PillButton>
        <PillButton
          variant="primary"
          size="sm"
          @click="handleCreateNew"
        >
          Create New
        </PillButton>
      </footer>
    </div>
  </dialog>
</template>

<style scoped lang="scss">
@use '../../assets/style/mixins' as *;

.location-picker-modal {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  overflow: auto;
  z-index: 1000;

  &::backdrop {
    background-color: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
  }

  &[open] {
    display: flex;
    align-items: center;
    justify-content: center;
  }
}

.modal-content {
  background: white;
  border-radius: 0.75rem;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  width: 90vw;
  max-width: 32rem;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--pav-color-stone-200);

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-800);
    border-color: var(--pav-color-stone-700);
  }
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid var(--pav-color-stone-200);

  @media (prefers-color-scheme: dark) {
    border-bottom-color: var(--pav-color-stone-700);
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
    color: var(--pav-color-stone-900);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }

  .close-button {
    background: transparent;
    border: none;
    font-size: 2rem;
    line-height: 1;
    color: var(--pav-color-stone-500);
    cursor: pointer;
    padding: 0;
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.25rem;
    transition: all 0.15s ease;

    &:hover {
      background: var(--pav-color-stone-100);
      color: var(--pav-color-stone-700);

      @media (prefers-color-scheme: dark) {
        background: var(--pav-color-stone-700);
        color: var(--pav-color-stone-300);
      }
    }

    &:focus-visible {
      outline: 2px solid var(--pav-color-orange-500);
      outline-offset: 2px;
    }
  }
}

.search-section {
  padding: 1.5rem;
  padding-bottom: 1rem;

  .search-input-wrapper {
    position: relative;

    .search-icon {
      position: absolute;
      left: 1rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--pav-color-stone-400);
      pointer-events: none;

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-stone-500);
      }
    }

    .search-input {
      width: 100%;
      padding: 0.75rem 1rem 0.75rem 2.75rem;
      border-radius: 9999px;
      border: 1px solid var(--pav-color-stone-200);
      background: var(--pav-color-stone-50);
      color: var(--pav-color-stone-900);
      font-size: 0.9375rem;
      transition: all 0.15s ease;

      &::placeholder {
        color: var(--pav-color-stone-400);
      }

      &:focus {
        outline: none;
        border-color: var(--pav-color-orange-500);
        background: white;
        box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.1);
      }

      @media (prefers-color-scheme: dark) {
        background: var(--pav-color-stone-700);
        border-color: var(--pav-color-stone-600);
        color: var(--pav-color-stone-100);

        &:focus {
          background: var(--pav-color-stone-800);
        }
      }
    }
  }
}

.location-list-container {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 0 1.5rem 1rem;
}

.location-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.location-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  border-radius: 0.5rem;
  border: 1px solid var(--pav-color-stone-200);
  background: white;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--pav-color-stone-50);
    border-color: var(--pav-color-stone-300);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-orange-500);
    outline-offset: 2px;
  }

  &.selected {
    border-color: var(--pav-color-orange-500);
    background: rgba(249, 115, 22, 0.05);
  }

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-700);
    border-color: var(--pav-color-stone-600);

    &:hover {
      background: var(--pav-color-stone-600);
      border-color: var(--pav-color-stone-500);
    }

    &.selected {
      background: rgba(249, 115, 22, 0.1);
    }
  }

  .location-icon {
    flex-shrink: 0;
    color: var(--pav-color-stone-500);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  .location-info {
    flex: 1;
    min-width: 0;
  }

  .location-name {
    font-weight: 500;
    color: var(--pav-color-stone-900);
    margin-bottom: 0.25rem;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }

  .location-address {
    font-size: 0.875rem;
    color: var(--pav-color-stone-600);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  .checkmark {
    flex-shrink: 0;
    color: var(--pav-color-orange-500);
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 1rem;
  text-align: center;
  color: var(--pav-color-stone-600);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }

  .empty-icon {
    color: var(--pav-color-stone-400);
    margin-bottom: 1rem;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-500);
    }
  }

  p {
    margin: 0.5rem 0;
  }

  .empty-hint {
    font-size: 0.875rem;
    color: var(--pav-color-stone-500);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-500);
    }
  }
}

.modal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-top: 1px solid var(--pav-color-stone-200);

  @media (prefers-color-scheme: dark) {
    border-top-color: var(--pav-color-stone-700);
  }
}
</style>
