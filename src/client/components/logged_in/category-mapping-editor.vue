<script setup lang="ts">
import { useTranslation } from 'i18next-vue';

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
 */
function getMappedLocalId(sourceCategoryId: string): string {
  return props.modelValue.find(m => m.sourceCategoryId === sourceCategoryId)?.localCategoryId ?? '';
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
</script>

<template>
  <div class="category-mapping-editor">
    <div
      v-if="sourceCategories.length > 0"
      role="group"
      :aria-label="t('group_label')"
    >
      <div
        v-for="cat in sourceCategories"
        :key="cat.id"
        class="mapping-row"
      >
        <span class="source-name">{{ cat.name }}</span>
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
        </select>
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

  .source-name {
    flex: 1;
    font-weight: 500;
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
