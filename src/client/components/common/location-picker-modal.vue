<script setup lang="ts">
import { ref, computed } from 'vue';
import i18next from 'i18next';
import { useTranslation } from 'i18next-vue';
import { Search, MapPin, Check } from 'lucide-vue-next';
import PillButton from '@/client/components/common/pill-button.vue';
import Sheet from '@/client/components/common/Sheet.vue';
import type { EventLocation, EventLocationSpace } from '@/common/model/location';

const { t } = useTranslation('event_editor', { keyPrefix: 'location_picker' });
// Separate handle for the calendars/places namespace where the new
// place.format.with_space and place.picker.whole_venue_suffix keys live.
const { t: tPlaces } = useTranslation('calendars', { keyPrefix: 'places' });

/**
 * LocationPickerModal Component
 *
 * Modal dialog for selecting a Place or a specific Space within a Place.
 * Renders a flat list:
 *   - 1 entry per Space-less Place (selecting `(placeId, null)`)
 *   - 1 + N entries per Place with N Spaces:
 *       * `${Place.name} (whole venue)` selecting `(placeId, null)`
 *       * `${Place.name} — ${Space.name}` per Space, selecting `(placeId, spaceId)`
 *
 * Search filters against the rendered display string, so typing "pacific"
 * matches "Convention Center — Pacific Room".
 *
 * Selection emits `{ placeId, spaceId | null }`. Callers must treat
 * `spaceId === null` as "whole venue" — distinct from `undefined`.
 *
 * Visual disambiguation:
 *   - Whole-venue suffix is rendered in `var(--pav-text-secondary)`.
 *   - Space entries are indented via `padding-inline-start` so they nest
 *     visually under their parent Place.
 *
 * @component
 *
 * Props:
 * @prop {EventLocation[]} locations - Available Places.
 * @prop {Record<string, EventLocationSpace[]>} spacesByPlace - Spaces keyed by parent Place id.
 *   Pass `locationStore.spacesByPlace` (or a derived map). Missing entries are treated as 0 Spaces.
 * @prop {string | null} selectedLocationId - Currently selected Place id, or null.
 * @prop {string | null} selectedSpaceId - Currently selected Space id, or null for whole-venue.
 *
 * Emits:
 * @emits location-selected - User picked an entry.
 *   @param {{ placeId: string, spaceId: string | null }} selection
 * @emits create-new
 * @emits remove-location
 * @emits close
 */

interface PickerEntry {
  key: string;
  placeId: string;
  spaceId: string | null;
  placeName: string;
  spaceName: string | null;
  isWholeVenue: boolean;   // true for whole-venue entries on multi-Space Places
  isSpaceEntry: boolean;   // true for the Space entries (used for visual indent)
  displayName: string;     // concatenated name, search target
  ariaLabel: string;
  address: string;
}

const props = defineProps<{
  locations: EventLocation[];
  spacesByPlace: Record<string, EventLocationSpace[]>;
  selectedLocationId: string | null;
  selectedSpaceId: string | null;
}>();

const emit = defineEmits<{
  (e: 'location-selected', selection: { placeId: string; spaceId: string | null }): void;
  (e: 'create-new'): void;
  (e: 'remove-location'): void;
  (e: 'close'): void;
}>();

const sheetRef = ref<InstanceType<typeof Sheet> | null>(null);
const searchQuery = ref('');

/**
 * Localized name for a Space using the current i18n language with fallback to
 * any populated content. Returns an empty string when no content is set.
 */
const spaceNameForCurrentLanguage = (space: EventLocationSpace): string => {
  const lang = i18next.language || 'en';
  // Prefer current language; fall back to first language with content.
  const languages = space.getLanguages();
  if (languages.length === 0) return '';
  const preferred = languages.includes(lang) ? lang : languages[0];
  return space.content(preferred).name ?? '';
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

/**
 * Flatten Places + Spaces into a single list of picker entries.
 * - Place with 0 Spaces → 1 entry (placeId, null)
 * - Place with N>=1 Spaces → 1 whole-venue entry (placeId, null)
 *   plus N Space entries (placeId, spaceId)
 */
const allEntries = computed<PickerEntry[]>(() => {
  const wholeVenueSuffix = tPlaces('picker.whole_venue_suffix');
  const entries: PickerEntry[] = [];

  for (const place of props.locations) {
    const spaces = props.spacesByPlace[place.id] ?? [];
    const address = formatAddress(place);

    if (spaces.length === 0) {
      // Space-less Place: single entry, no whole-venue suffix.
      entries.push({
        key: `place:${place.id}`,
        placeId: place.id,
        spaceId: null,
        placeName: place.name,
        spaceName: null,
        isWholeVenue: false,
        isSpaceEntry: false,
        displayName: place.name,
        ariaLabel: place.name,
        address,
      });
      continue;
    }

    // Whole-venue entry for multi-Space Places.
    entries.push({
      key: `place:${place.id}:whole`,
      placeId: place.id,
      spaceId: null,
      placeName: place.name,
      spaceName: null,
      isWholeVenue: true,
      isSpaceEntry: false,
      displayName: `${place.name} ${wholeVenueSuffix}`,
      ariaLabel: `${place.name}, ${stripParens(wholeVenueSuffix)}`,
      address,
    });

    for (const space of spaces) {
      const spaceName = spaceNameForCurrentLanguage(space);
      const concatenated = tPlaces('format.with_space', { place: place.name, space: spaceName });
      entries.push({
        key: `space:${space.id}`,
        placeId: place.id,
        spaceId: space.id,
        placeName: place.name,
        spaceName,
        isWholeVenue: false,
        isSpaceEntry: true,
        displayName: concatenated,
        ariaLabel: `${place.name}, ${spaceName}`,
        address,
      });
    }
  }

  return entries;
});

/**
 * Strip surrounding parentheses from a localized suffix so the aria-label
 * reads naturally. "(whole venue)" → "whole venue".
 */
function stripParens(text: string): string {
  return text.replace(/^\s*\(/, '').replace(/\)\s*$/, '');
}

// Filter entries by their rendered display string + address.
const filteredEntries = computed<PickerEntry[]>(() => {
  if (!searchQuery.value.trim()) {
    return allEntries.value;
  }

  const query = searchQuery.value.toLowerCase();
  return allEntries.value.filter((entry) => {
    // Search target: the rendered display string the user sees, plus the
    // Place's address fields so address-based search keeps working.
    const haystack = [entry.displayName, entry.address].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(query);
  });
});

const hasLocations = computed(() => props.locations.length > 0);

const isSelected = (entry: PickerEntry): boolean => {
  return entry.placeId === props.selectedLocationId
    && entry.spaceId === props.selectedSpaceId;
};

const handleEntryClick = (entry: PickerEntry) => {
  emit('location-selected', { placeId: entry.placeId, spaceId: entry.spaceId });
};

const handleCreateNew = () => {
  emit('create-new');
};

const handleRemoveLocation = () => {
  emit('remove-location');
};

const close = () => {
  emit('close');
};

// Expose methods to parent (for backward compatibility)
defineExpose({ close, sheetRef });
</script>

<template>
  <Sheet
    ref="sheetRef"
    :title="t('title')"
    @close="close"
  >
    <div class="location-picker-body">
      <!-- Search Input -->
      <div class="search-section">
        <div class="search-input-wrapper">
          <Search :size="20" class="search-icon" />
          <input
            v-model="searchQuery"
            type="text"
            class="search-input"
            :placeholder="t('search_placeholder')"
            :aria-label="t('aria_search_label')"
          />
        </div>
      </div>

      <!-- Location List -->
      <div class="location-list-container">
        <div v-if="hasLocations && filteredEntries.length > 0" class="location-list">
          <div
            v-for="entry in filteredEntries"
            :key="entry.key"
            class="location-item"
            :class="{
              selected: isSelected(entry),
              'is-space-entry': entry.isSpaceEntry,
            }"
            role="button"
            tabindex="0"
            :aria-label="entry.ariaLabel"
            @click="handleEntryClick(entry)"
            @keydown.enter="handleEntryClick(entry)"
            @keydown.space.prevent="handleEntryClick(entry)"
          >
            <MapPin :size="20" class="location-icon" />
            <div class="location-info">
              <div class="location-name">
                <template v-if="entry.isWholeVenue">
                  <span>{{ entry.placeName }}</span>
                  {{ ' ' }}
                  <span class="whole-venue-suffix">
                    {{ tPlaces('picker.whole_venue_suffix') }}
                  </span>
                </template>
                <template v-else>
                  {{ entry.displayName }}
                </template>
              </div>
              <div v-if="entry.address" class="location-address">
                {{ entry.address }}
              </div>
            </div>
            <Check v-if="isSelected(entry)" :size="20" class="checkmark" />
          </div>
        </div>

        <div v-else-if="!hasLocations" class="empty-state">
          <MapPin :size="48" class="empty-icon" />
          <p>{{ t('empty_title') }}</p>
          <p class="empty-hint">{{ t('empty_help') }}</p>
        </div>

        <div v-else class="empty-state">
          <p>{{ t('no_results') }}</p>
        </div>
      </div>

      <!-- Footer -->
      <footer class="picker-footer">
        <PillButton
          variant="ghost"
          size="sm"
          @click="handleRemoveLocation"
        >
          {{ t('remove_button') }}
        </PillButton>
        <PillButton
          variant="primary"
          size="sm"
          @click="handleCreateNew"
        >
          {{ t('create_new_button') }}
        </PillButton>
      </footer>
    </div>
  </Sheet>
</template>

<style scoped lang="scss">
@use '../../assets/style/mixins' as *;

.location-picker-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 0;
}

.search-section {
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

  // Indent and shrink Space entries so they read as children of the Place
  // entry above. Margin (not padding) moves the box itself; a subtle
  // accent border on the inline-start edge provides a tree-connector cue
  // so the Place / Space hierarchy is unambiguous even on a 1-Space Place.
  // Logical properties keep the indent + connector on the inline-start
  // side under RTL.
  &.is-space-entry {
    margin-inline-start: 1.5rem;
    border-inline-start: 3px solid var(--pav-color-stone-300);

    @media (prefers-color-scheme: dark) {
      border-inline-start-color: var(--pav-color-stone-500);
    }
  }

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

  // De-emphasize the "(whole venue)" suffix so sighted users can scan past
  // the suffix to the Place name. Pairs with the indent on Space entries to
  // make the Place/Space hierarchy visible at a glance.
  .whole-venue-suffix {
    color: var(--pav-text-secondary);
    margin-inline-start: 0.25rem;
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

.picker-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 1rem;
  border-top: 1px solid var(--pav-color-stone-200);

  @media (prefers-color-scheme: dark) {
    border-top-color: var(--pav-color-stone-700);
  }
}
</style>
