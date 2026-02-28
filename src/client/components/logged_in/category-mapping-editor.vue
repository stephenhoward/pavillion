<script setup lang="ts">
import { useTranslation } from 'i18next-vue';
import { ADD_CATEGORY_VALUE } from './category-mapping-constants';

interface SourceCategory {
  id: string;
  name: string;
}

interface LocalCategory {
  id: string;
  name: string;
}

interface MappingEntry {
  sourceCategoryId: string;
  sourceCategoryName: string;
  localCategoryId: string;
}

const props = defineProps<{
  sourceCategories: SourceCategory[];
  localCategories: LocalCategory[];
  modelValue: MappingEntry[];
}>();

const emit = defineEmits<{
  'update:modelValue': [MappingEntry[]];
}>();

const { t } = useTranslation('calendars', { keyPrefix: 'category_mapping' });

/**
 * Returns the mapped local category ID for a given source category, or '' if none.
 * Returns ADD_CATEGORY_VALUE if the user has toggled "add this category".
 */
function getMappedLocalId(sourceCategoryId: string): string {
  return props.modelValue.find(m => m.sourceCategoryId === sourceCategoryId)?.localCategoryId ?? '';
}

/**
 * Returns true when the given source category is toggled to "add this category".
 */
function isAddToggled(sourceCategoryId: string): boolean {
  return getMappedLocalId(sourceCategoryId) === ADD_CATEGORY_VALUE;
}

/**
 * Handles a dropdown selection change for a source category row.
 * Adds/updates or removes the mapping entry depending on whether a local category was selected.
 */
function onSelect(sourceCat: SourceCategory, localCategoryId: string) {
  const filtered = props.modelValue.filter(m => m.sourceCategoryId !== sourceCat.id);
  if (localCategoryId) {
    emit('update:modelValue', [
      ...filtered,
      { sourceCategoryId: sourceCat.id, sourceCategoryName: sourceCat.name, localCategoryId },
    ]);
  }
  else {
    emit('update:modelValue', filtered);
  }
}

/**
 * Handles the "Add this category" toggle button click (no-local-categories mode).
 * Toggles the mapping between ADD_CATEGORY_VALUE and unmapped.
 */
function onToggleAdd(sourceCat: SourceCategory) {
  const filtered = props.modelValue.filter(m => m.sourceCategoryId !== sourceCat.id);
  if (!isAddToggled(sourceCat.id)) {
    emit('update:modelValue', [
      ...filtered,
      { sourceCategoryId: sourceCat.id, sourceCategoryName: sourceCat.name, localCategoryId: ADD_CATEGORY_VALUE },
    ]);
  }
  else {
    emit('update:modelValue', filtered);
  }
}
</script>

<template>
  <div class="category-mapping-editor">
    <div
      v-if="sourceCategories.length > 0"
      role="group"
      :aria-label="t('group_label')"
    >
      <!-- Column headers: only shown when there are local categories (dropdown mode) -->
      <div
        v-if="localCategories.length > 0"
        class="mapping-row column-headers"
        aria-hidden="true"
      >
        <span class="source-name">{{ t('source_column_label') }}</span>
        <span class="mapping-arrow" />
        <span class="column-header-local">{{ t('local_column_label') }}</span>
      </div>

      <div
        v-for="cat in sourceCategories"
        :key="cat.id"
        class="mapping-row"
      >
        <span class="source-name">{{ cat.name }}</span>

        <!-- No local categories: show toggle button -->
        <template v-if="localCategories.length === 0">
          <button
            type="button"
            role="switch"
            class="add-toggle"
            :class="{ active: isAddToggled(cat.id) }"
            :aria-checked="isAddToggled(cat.id)"
            :aria-label="t('add_category_toggle_label', { name: cat.name })"
            @click="onToggleAdd(cat)"
          >
            {{ isAddToggled(cat.id) ? t('add_category_toggled') : t('add_category_toggle') }}
          </button>
        </template>

        <!-- Has local categories: show dropdown with "Add this category" option -->
        <template v-else>
          <span
            class="mapping-arrow"
            aria-hidden="true"
          >→</span>
          <select
            :value="getMappedLocalId(cat.id)"
            :aria-label="t('dropdown_label', { name: cat.name })"
            @change="onSelect(cat, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ t('no_mapping') }}</option>
            <option
              v-for="local in localCategories"
              :key="local.id"
              :value="local.id"
            >
              {{ local.name }}
            </option>
            <option :value="ADD_CATEGORY_VALUE">
              {{ t('add_category_option') }}
            </option>
          </select>
        </template>
      </div>
    </div>

    <p
      v-if="sourceCategories.length === 0"
      class="empty-state"
    >
      {{ t('no_source_categories') }}
    </p>
  </div>
</template>

<style scoped lang="scss">
.category-mapping-editor {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-3);
}

.mapping-row {
  display: flex;
  align-items: center;
  gap: var(--pav-space-3);

  &.column-headers {
    .source-name,
    .column-header-local {
      font-size: 0.75rem;
      font-weight: var(--pav-font-weight-bold);
      color: var(--pav-color-stone-500);
      text-transform: uppercase;
      letter-spacing: 0.05em;

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-stone-400);
      }
    }
  }

  .column-header-local {
    flex: 1;
  }

  .source-name {
    flex: 1;
    font-weight: var(--pav-font-weight-medium);
    color: var(--pav-color-stone-900);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }

  .mapping-arrow {
    color: var(--pav-color-stone-400);
    flex-shrink: 0;
  }

  select {
    flex: 1;
    padding: var(--pav-space-2) var(--pav-space-3);
    border: 1px solid var(--pav-border-primary);
    border-radius: 0.5rem;
    background: var(--pav-color-stone-50);
    color: var(--pav-color-stone-900);
    font-size: 0.875rem;
    cursor: pointer;
    min-width: 0;

    &:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px oklch(0.705 0.213 47.604 / 0.4);
      border-color: var(--pav-color-orange-500);
    }

    @media (prefers-color-scheme: dark) {
      background: var(--pav-color-stone-800);
      color: var(--pav-color-stone-100);
    }
  }

  .add-toggle {
    flex: 1;
    padding: var(--pav-space-2) var(--pav-space-3);
    border: 1px solid var(--pav-border-primary);
    border-radius: 0.5rem;
    background: var(--pav-color-stone-50);
    color: var(--pav-color-stone-700);
    font-size: 0.875rem;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;

    &:hover {
      background: var(--pav-color-stone-100);

      @media (prefers-color-scheme: dark) {
        background: var(--pav-color-stone-700);
      }
    }

    &.active {
      background: var(--pav-color-orange-50, oklch(0.97 0.03 60));
      border-color: var(--pav-color-orange-500);
      color: var(--pav-color-orange-700, oklch(0.5 0.18 50));

      @media (prefers-color-scheme: dark) {
        background: oklch(0.25 0.05 50);
        color: var(--pav-color-orange-300, oklch(0.78 0.14 55));
      }
    }

    &:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px oklch(0.705 0.213 47.604 / 0.4);
      border-color: var(--pav-color-orange-500);
    }

    @media (prefers-color-scheme: dark) {
      background: var(--pav-color-stone-800);
      color: var(--pav-color-stone-300);
    }
  }
}

.empty-state {
  color: var(--pav-color-stone-500);
  font-size: 0.875rem;
  text-align: center;
  padding: var(--pav-space-4);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}
</style>
