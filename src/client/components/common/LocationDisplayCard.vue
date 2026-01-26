<script setup lang="ts">
import { computed } from 'vue';
import PillButton from '@/client/components/common/PillButton.vue';
import type { EventLocation } from '@/common/model/location';

/**
 * LocationDisplayCard Component
 *
 * Displays event location information with a change/add button.
 * Used in event editor to show and manage location selection.
 *
 * When a location is set, displays the location name, address details, and a
 * "Change" button. When no location is set, displays an "Add Location" button
 * with a dashed border and MapPin icon.
 *
 * @component
 *
 * Props:
 * @prop {EventLocation | null} location - The event location to display, or null for empty state
 *
 * Emits:
 * @emits change-location - Fired when user clicks "Change" button (when location exists)
 * @emits add-location - Fired when user clicks "Add Location" button (when no location)
 */

const props = defineProps<{
  location: EventLocation | null;
}>();

const emit = defineEmits<{
  (e: 'change-location'): void;
  (e: 'add-location'): void;
}>();

const hasLocation = computed(() => {
  return props.location !== null && !!props.location.name;
});

const addressParts = computed(() => {
  if (!props.location) return [];
  return [
    props.location.address,
    props.location.city,
    props.location.state,
    props.location.postalCode,
  ].filter(Boolean);
});

const formattedAddress = computed(() => addressParts.value.join(', '));

const handleButtonClick = () => {
  if (hasLocation.value) {
    emit('change-location');
  }
  else {
    emit('add-location');
  }
};
</script>

<template>
  <!-- When location is set: show info with Change button -->
  <div v-if="hasLocation" class="location-display-card location-display-card--filled">
    <div class="location-info">
      <div class="location-name">{{ location?.name }}</div>
      <div v-if="formattedAddress" class="location-address">{{ formattedAddress }}</div>
    </div>

    <PillButton
      variant="ghost"
      size="sm"
      class="action-button"
      @click="handleButtonClick"
    >
      Change
    </PillButton>
  </div>

  <!-- When location is empty: show Add Location button with nested borders -->
  <div v-else class="location-display-card location-display-card--empty">
    <button
      class="add-location-button"
      @click="handleButtonClick"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="icon"
      >
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
      Add Location
    </button>
  </div>
</template>

<style scoped lang="scss">
@use '../../assets/style/mixins' as *;
@use '../../assets/style/components/event-management' as *;

.location-display-card {
  @include section-card;
}

// Filled state: location info + Change button
.location-display-card--filled {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

// Empty state: outer card container with solid border (from section-card mixin)
.location-display-card--empty {
  // section-card mixin provides the solid border
  // Inner button will have dashed border
}

// Inner button with dashed border inside the solid card
.add-location-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 1.5rem;
  border: 2px dashed var(--pav-color-stone-300);
  border-radius: 12px;
  background: transparent;
  color: var(--pav-color-stone-600);
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease-in-out;

  &:hover {
    border-color: var(--pav-color-stone-400);
    color: var(--pav-color-stone-700);
    background: var(--pav-color-stone-50);
  }

  @media (prefers-color-scheme: dark) {
    border-color: var(--pav-color-stone-700);
    color: var(--pav-color-stone-400);

    &:hover {
      border-color: var(--pav-color-stone-600);
      color: var(--pav-color-stone-300);
      background: var(--pav-color-stone-800);
    }
  }

  .icon {
    flex-shrink: 0;
  }
}

.location-info {
  flex: 1;
  min-width: 0; // Allow text truncation
}

.location-name {
  font-weight: 600;
  font-size: 1rem;
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

.action-button {
  flex-shrink: 0;
}
</style>
