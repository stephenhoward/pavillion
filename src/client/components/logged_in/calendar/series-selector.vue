<script setup>
import { reactive, onMounted, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import SeriesService from '@/client/service/series';

const props = defineProps({
  calendarId: {
    type: String,
    required: true,
  },
  selectedSeriesId: {
    type: String,
    default: null,
  },
  eventId: {
    type: String,
    default: null,
  },
});

const emit = defineEmits(['seriesChanged']);

const { t } = useTranslation('event_editor', {
  keyPrefix: 'series',
});

const seriesService = new SeriesService();
const currentLanguage = 'en'; // TODO: Get from language picker/preference

const state = reactive({
  availableSeries: [],
  currentSeriesId: null,
  isLoading: false,
  error: '',
});

/**
 * Load series for the calendar
 */
async function loadSeries() {
  if (!props.calendarId) return;

  state.isLoading = true;
  state.error = '';

  try {
    state.availableSeries = await seriesService.loadSeries(props.calendarId);
  }
  catch (error) {
    console.error('Error loading series:', error);
    state.error = t('error_loading_series');
  }
  finally {
    state.isLoading = false;
  }
}

/**
 * Handle select change — emit the new series ID (or null for None)
 */
function handleChange(event) {
  const value = event.target.value;
  state.currentSeriesId = value || null;
  emit('seriesChanged', state.currentSeriesId);
}

/**
 * Get the display name for a series
 */
function getSeriesName(series) {
  return series.content(currentLanguage)?.name || series.urlName || series.id;
}

// Watch for calendarId changes to reload series
watch(() => props.calendarId, (newCalendarId) => {
  if (newCalendarId) {
    loadSeries();
  }
});

// Watch for selectedSeriesId prop changes (including initial value)
watch(() => props.selectedSeriesId, (newSeriesId) => {
  state.currentSeriesId = newSeriesId || null;
}, { immediate: true });

// Load series when component mounts
onMounted(async () => {
  await loadSeries();
});
</script>

<template>
  <div class="series-selector">
    <label
      for="series-select"
      class="series-label"
    >{{ t('series_label') }}</label>

    <!-- Loading State -->
    <div
      v-if="state.isLoading"
      class="loading"
      role="status"
      aria-live="polite"
    >
      {{ t('loading_series') }}
    </div>

    <!-- Error State -->
    <div
      v-else-if="state.error"
      class="error"
      role="alert"
    >
      {{ state.error }}
    </div>

    <!-- Loaded State: Select or no-series message -->
    <div
      v-else
      class="series-loaded"
    >
      <select
        id="series-select"
        class="series-select"
        :value="state.currentSeriesId || ''"
        :aria-label="t('series_label')"
        @change="handleChange"
      >
        <option value="">{{ t('none_option') }}</option>
        <option
          v-for="series in state.availableSeries"
          :key="series.id"
          :value="series.id"
        >
          {{ getSeriesName(series) }}
        </option>
      </select>

      <p
        v-if="state.availableSeries.length === 0"
        class="no-series help-text"
      >
        {{ t('no_series_help') }}
      </p>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/client/assets/style/components/event-management' as *;

.series-selector {
  margin-bottom: 1.5rem;
}

.series-label {
  @include section-label;
  display: block;
  margin-bottom: 0.75rem;
}

.loading {
  text-align: center;
  padding: 1rem;
  color: var(--pav-color-stone-600);
  font-size: 0.875rem;
  font-style: italic;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.error {
  padding: 1rem;
  margin-bottom: 1rem;
  background-color: var(--pav-color-red-50);
  border: 1px solid var(--pav-color-red-200);
  border-radius: 0.75rem;
  color: var(--pav-color-red-700);
  font-size: 0.875rem;

  @media (prefers-color-scheme: dark) {
    background-color: rgba(239, 68, 68, 0.1);
    border-color: var(--pav-color-red-900);
    color: var(--pav-color-red-300);
  }
}

.series-loaded {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.series-select {
  width: 100%;
  padding: 0.625rem 0.75rem;
  font-size: 0.875rem;
  border: 1px solid var(--pav-color-stone-300);
  border-radius: 0.5rem;
  background-color: var(--pav-color-white);
  color: var(--pav-color-stone-900);
  cursor: pointer;
  appearance: auto;

  &:focus {
    outline: 2px solid var(--pav-color-primary-500);
    outline-offset: 2px;
    border-color: var(--pav-color-primary-500);
  }

  @media (prefers-color-scheme: dark) {
    background-color: var(--pav-color-stone-800);
    border-color: var(--pav-color-stone-600);
    color: var(--pav-color-stone-100);
  }
}

.no-series {
  font-size: 0.75rem;
  color: var(--pav-color-stone-500);
  margin: 0;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}
</style>
