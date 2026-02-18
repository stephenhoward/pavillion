<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import CategoryMappingEditor from '@/client/components/logged_in/category-mapping-editor.vue';
import FeedService, { type CategoryEntry, type CategoryMappingEntry } from '@/client/service/feed';

const props = defineProps<{
  calendarId: string;
  actorId: string;
}>();

const { t } = useTranslation('calendars', { keyPrefix: 'category_mapping' });

const sourceCategories = ref<CategoryEntry[]>([]);
const localCategories = ref<CategoryEntry[]>([]);
const mappings = ref<CategoryMappingEntry[]>([]);
const loading = ref(true);
const saving = ref(false);
const saveSuccess = ref(false);
const loadError = ref('');
const saveError = ref('');

onMounted(async () => {
  const feedService = new FeedService();
  try {
    const [src, own, existing] = await Promise.all([
      feedService.getSourceCategories(props.calendarId, props.actorId),
      feedService.getCalendarCategories(props.calendarId),
      feedService.getCategoryMappings(props.calendarId, props.actorId),
    ]);
    sourceCategories.value = src;
    localCategories.value = own;
    mappings.value = existing;
  }
  catch {
    loadError.value = t('load_error');
  }
  finally {
    loading.value = false;
  }
});

/**
 * Save current mappings to the server.
 */
async function save() {
  saving.value = true;
  saveSuccess.value = false;
  saveError.value = '';
  try {
    const feedService = new FeedService();
    await feedService.setCategoryMappings(props.calendarId, props.actorId, mappings.value);
    saveSuccess.value = true;
    setTimeout(() => {
      saveSuccess.value = false;
    }, 3000);
  }
  catch {
    saveError.value = t('save_error');
  }
  finally {
    saving.value = false;
  }
}
</script>

<template>
  <div
    class="category-mappings-page"
    :aria-busy="loading ? 'true' : 'false'"
  >
    <div class="page-header">
      <h1>{{ t('page_title') }}</h1>
      <p class="subtitle">{{ t('page_subtitle') }}</p>
    </div>

    <div
      v-if="loading"
      class="loading-state"
      role="status"
      aria-live="polite"
    >
      {{ t('loading') }}
    </div>

    <div
      v-else-if="loadError"
      class="error-state"
      role="alert"
    >
      {{ loadError }}
    </div>

    <div
      v-else
      class="mappings-content"
    >
      <CategoryMappingEditor
        v-model="mappings"
        :source-categories="sourceCategories"
        :local-categories="localCategories"
      />

      <div class="save-row">
        <button
          type="button"
          class="save-button"
          :disabled="saving"
          :aria-disabled="saving ? 'true' : undefined"
          @click="save"
        >
          {{ saving ? t('saving') : t('save') }}
        </button>

        <span
          class="save-feedback success"
          role="status"
          aria-live="polite"
        >
          {{ saveSuccess ? t('save_success') : '' }}
        </span>
        <span
          class="save-feedback error"
          role="alert"
          aria-live="assertive"
        >
          {{ saveError }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.category-mappings-page {
  max-width: 42rem;
  margin: 0 auto;
  padding: var(--pav-space-4);

  @media (min-width: 640px) {
    padding: var(--pav-space-6);
  }
}

.page-header {
  margin-bottom: var(--pav-space-6);

  h1 {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--pav-color-stone-900);
    margin: 0;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }

  .subtitle {
    margin-top: var(--pav-space-1);
    font-size: 0.875rem;
    color: var(--pav-color-stone-500);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }
}

.loading-state {
  padding: var(--pav-space-8);
  text-align: center;
  color: var(--pav-color-stone-500);
  font-style: italic;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.error-state {
  padding: var(--pav-space-4);
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 0.75rem;
  color: var(--pav-color-red-700);
  font-size: 0.875rem;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-red-400);
    background: rgba(239, 68, 68, 0.05);
  }
}

.mappings-content {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);
  background: white;
  border-radius: 1rem;
  border: 1px solid var(--pav-color-stone-200);
  padding: var(--pav-space-6);

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-900);
    border-color: var(--pav-color-stone-800);
  }
}

.save-row {
  display: flex;
  align-items: center;
  gap: var(--pav-space-4);
  padding-top: var(--pav-space-4);
  border-top: 1px solid var(--pav-color-stone-100);

  @media (prefers-color-scheme: dark) {
    border-top-color: var(--pav-color-stone-800);
  }
}

.save-button {
  padding: 0.625rem 1.25rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: white;
  background: var(--pav-color-orange-500);
  border: none;
  border-radius: 9999px;
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover:not(:disabled) {
    background: var(--pav-color-orange-600);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-orange-500);
    outline-offset: 2px;
    box-shadow: 0 0 0 4px rgba(249, 115, 22, 0.2);
  }
}

.save-feedback {
  font-size: 0.875rem;
  font-weight: 500;

  &.success {
    color: var(--pav-color-green-600);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-green-400);
    }
  }

  &.error {
    color: var(--pav-color-red-600);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-red-400);
    }
  }
}
</style>
