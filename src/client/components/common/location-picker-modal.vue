<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { Search, MapPin, DoorOpen, Check } from 'lucide-vue-next';
import DoorPlus from '@/client/components/common/icons/door-plus.vue';
import PillButton from '@/client/components/common/pill-button.vue';
import Sheet from '@/client/components/common/sheet.vue';
import { useLocalizedContent } from '@/client/composables/useLocalizedContent';
import type { EventLocation } from '@/common/model/location';

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
 * @prop {EventLocation[]} locations - Available Places. Each Place's Spaces
 *   are read inline from `place.spaces` (atomic Place + Spaces wire
 *   contract); a Place with no `spaces` array is treated as 0 Spaces.
 * @prop {string | null} selectedLocationId - Currently selected Place id, or null.
 * @prop {string | null} selectedSpaceId - Currently selected Space id, or null for whole-venue.
 * @prop {string} [initialSearch] - Optional seed for the search input. Applied
 *   on mount and when the prop transitions from empty to non-empty (so a
 *   parent that re-opens the modal without unmounting it can seed a fresh
 *   search). Defaults to ''. The user can edit or clear the seeded value
 *   freely once the modal is open.
 *
 * Emits:
 * @emits location-selected - User picked an entry.
 *   @param {{ placeId: string, spaceId: string | null }} selection
 * @emits add-space - User clicked the per-Place "add space" action button.
 *   @param {{ placeId: string }} payload
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

const props = withDefaults(defineProps<{
  locations: EventLocation[];
  selectedLocationId: string | null;
  selectedSpaceId: string | null;
  initialSearch?: string;
}>(), {
  initialSearch: '',
});

const emit = defineEmits<{
  (e: 'location-selected', selection: { placeId: string; spaceId: string | null }): void;
  (e: 'add-space', payload: { placeId: string }): void;
  (e: 'create-new'): void;
  (e: 'remove-location'): void;
  (e: 'close'): void;
}>();

const sheetRef = ref<InstanceType<typeof Sheet> | null>(null);
// Seed from initialSearch on mount so a parent that opens the modal with a
// pre-populated query (e.g. resuming a search after creating a new place)
// sees the term reflected in the input and the filtered list immediately.
const searchQuery = ref(props.initialSearch);
const { spaceDisplayName } = useLocalizedContent();

// Re-seed when initialSearch transitions from empty to non-empty. Covers the
// case where the parent reuses (rather than unmounts) the modal across opens
// — without this the second open would still show the first open's query.
// We deliberately do not reseed on non-empty -> non-empty changes or on
// clears so we never overwrite edits the user has typed mid-session.
watch(() => props.initialSearch, (next, prev) => {
  if (next && !prev) {
    searchQuery.value = next;
  }
});

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
    const spaces = place.spaces ?? [];
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
      const spaceName = spaceDisplayName(space);
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

const handleAddSpace = (entry: PickerEntry) => {
  emit('add-space', { placeId: entry.placeId });
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
        <ul v-if="hasLocations && filteredEntries.length > 0" role="list" class="location-list">
          <li v-for="entry in filteredEntries" :key="entry.key">
            <div class="location-row">
              <button
                type="button"
                class="location-item"
                :class="{
                  selected: isSelected(entry),
                  'is-space-entry': entry.isSpaceEntry,
                }"
                :aria-label="entry.ariaLabel"
                :aria-pressed="isSelected(entry)"
                @click="handleEntryClick(entry)"
              >
                <DoorOpen v-if="entry.isSpaceEntry" :size="20" class="location-icon" />
                <MapPin v-else :size="20" class="location-icon" />
                <div class="location-info">
                  <div class="location-name">
                    <template v-if="entry.isWholeVenue">
                      <span>{{ entry.placeName }}</span>
                      {{ ' ' }}
                      <span class="whole-venue-suffix">
                        {{ tPlaces('picker.whole_venue_suffix') }}
                      </span>
                    </template>
                    <template v-else-if="entry.isSpaceEntry">
                      {{ entry.spaceName }}
                    </template>
                    <template v-else>
                      {{ entry.displayName }}
                    </template>
                  </div>
                  <!--
                    Space entries: show parent Place name (de-emphasized) so the row
                    is self-describing when search filters out the parent. Other
                    entries: show address.
                  -->
                  <div v-if="entry.isSpaceEntry" class="location-parent-name">
                    {{ entry.placeName }}
                  </div>
                  <div v-else-if="entry.address" class="location-address">
                    {{ entry.address }}
                  </div>
                </div>
                <Check v-if="isSelected(entry)" :size="20" class="checkmark" />
              </button>
              <!--
                Per-Place "add space" affordance. Renders as a sibling of the
                select-button so AT users can tab to it independently and so it
                does not nest interactives. Hidden on Space sub-rows — those
                cannot host their own Spaces.
              -->
              <button
                v-if="!entry.isSpaceEntry"
                type="button"
                class="picker-add-space-button"
                :aria-label="t('add_space_aria', { name: entry.placeName })"
                @click="handleAddSpace(entry)"
              >
                <DoorPlus :size="20" />
              </button>
            </div>
          </li>
        </ul>

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
@use '../../assets/style/components/event-management' as *;

.location-picker-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 0;
}

.search-section {
  .search-input-wrapper {
    @include pill-search-input;

    // No clear button in this modal — collapse the right-side padding the
    // mixin reserves for it so the placeholder sits flush with the standard
    // input gutter.
    input {
      padding-inline-end: var(--pav-space-md);
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

// Row wrapper: hosts the select-button and the optional sibling
// picker-add-space-button so they read as visually distinct slots without
// nesting interactives. align-items: stretch lets the action button match
// the select-button's hover/selected box height; min-width: 0 on the
// select button (below) keeps the info column ellipsizable before the
// action gets squashed.
.location-row {
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
}

.location-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  border-radius: 0.5rem;
  border: 1px solid var(--pav-color-stone-200);
  background: var(--pav-surface-card);
  cursor: pointer;
  transition: all 0.15s ease;
  // Native button delta over the global button:not([role="tab"]) reset:
  // entries are full-width rows with leading-aligned content, not the
  // centered inline-flex shape the global rule sets up.
  text-align: start;
  // flex 1 so the select-button consumes the row's free width; min-width 0
  // lets the inner .location-info ellipsize before the sibling add-space
  // action gets squeezed.
  flex: 1;
  min-width: 0;

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

  .location-address,
  .location-parent-name {
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

// Per-Place "add space" sibling action. Sits at the row's true trailing
// edge (outside the select-button) so it cannot nest inside the select
// affordance and gets its own tab stop. Hit area is at least 44x44 CSS px
// per WCAG 2.5.5; padding is tuned to wrap the 20px DoorPlus icon.
//
// Class is namespaced (`picker-add-space-button`) to avoid colliding with
// SpacesEditor's `.add-space-button` when both components render in the
// same test wrapper — `wrapper.find('.add-space-button')` would otherwise
// match ambiguously.
.picker-add-space-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  min-inline-size: 44px;
  min-block-size: 44px;
  padding: 0.625rem; // (44 - 20) / 2 / 16 ≈ 0.75rem visual; tighter so the
  // icon centers without dwarfing the hit area.
  border-radius: 0.5rem;
  border: 1px solid var(--pav-color-stone-200);
  background: var(--pav-surface-card);
  color: var(--pav-color-stone-600);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--pav-color-stone-50);
    border-color: var(--pav-color-stone-300);
    color: var(--pav-color-stone-900);
  }

  // Match the existing orange ring on .location-item so the two siblings
  // read as a coherent affordance set under keyboard focus.
  &:focus-visible {
    outline: 2px solid var(--pav-color-orange-500);
    outline-offset: 2px;
  }

  @media (prefers-color-scheme: dark) {
    border-color: var(--pav-color-stone-600);
    color: var(--pav-color-stone-400);

    &:hover {
      background: var(--pav-color-stone-600);
      border-color: var(--pav-color-stone-500);
      color: var(--pav-color-stone-100);
    }
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
