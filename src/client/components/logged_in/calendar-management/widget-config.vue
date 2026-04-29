<template>
  <div class="widget-config">
    <div class="config-section settings">
      <h3>{{ t('configuration_title') }}</h3>
      <p class="section-description">{{ t('configuration_description') }}</p>

      <div class="form-group view-mode-group">
        <p id="view-mode-group-label" class="form-label">{{ t('view_mode_label') }}</p>
        <div class="view-mode-cards" role="group" aria-labelledby="view-mode-group-label">
          <button
            type="button"
            class="view-mode-card"
            :class="{ 'view-mode-card--selected': state.viewMode === 'list' }"
            :aria-pressed="state.viewMode === 'list'"
            @click="setViewMode('list')"
          >
            <div class="view-mode-card__illustration">
              <div class="list-illustration">
                <div class="list-line"/>
                <div class="list-line"/>
                <div class="list-line"/>
              </div>
            </div>
            <div class="view-mode-card__content">
              <div class="view-mode-card__title">{{ t('view_mode_list_title') }}</div>
              <div class="view-mode-card__description">{{ t('view_mode_list_description') }}</div>
            </div>
            <div v-if="state.viewMode === 'list'" class="view-mode-card__checkmark">
              <svg xmlns="http://www.w3.org/2000/svg"
                   width="20"
                   height="20"
                   viewBox="0 0 24 24"
                   fill="none"
                   stroke="currentColor"
                   stroke-width="2"
                   stroke-linecap="round"
                   stroke-linejoin="round"
                   aria-hidden="true">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
          </button>

          <button
            type="button"
            class="view-mode-card"
            :class="{ 'view-mode-card--selected': state.viewMode === 'week' }"
            :aria-pressed="state.viewMode === 'week'"
            @click="setViewMode('week')"
          >
            <div class="view-mode-card__illustration">
              <div class="week-illustration">
                <div class="week-day"/>
                <div class="week-day"/>
                <div class="week-day week-day--highlight"/>
                <div class="week-day"/>
                <div class="week-day week-day--highlight"/>
                <div class="week-day"/>
                <div class="week-day"/>
              </div>
            </div>
            <div class="view-mode-card__content">
              <div class="view-mode-card__title">{{ t('view_mode_week_title') }}</div>
              <div class="view-mode-card__description">{{ t('view_mode_week_description') }}</div>
            </div>
            <div v-if="state.viewMode === 'week'" class="view-mode-card__checkmark">
              <svg xmlns="http://www.w3.org/2000/svg"
                   width="20"
                   height="20"
                   viewBox="0 0 24 24"
                   fill="none"
                   stroke="currentColor"
                   stroke-width="2"
                   stroke-linecap="round"
                   stroke-linejoin="round"
                   aria-hidden="true">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
          </button>

          <button
            type="button"
            class="view-mode-card"
            :class="{ 'view-mode-card--selected': state.viewMode === 'month' }"
            :aria-pressed="state.viewMode === 'month'"
            @click="setViewMode('month')"
          >
            <div class="view-mode-card__illustration">
              <div class="month-illustration">
                <div class="month-row">
                  <div class="month-cell"/>
                  <div class="month-cell"/>
                  <div class="month-cell month-cell--highlight"/>
                  <div class="month-cell"/>
                  <div class="month-cell month-cell--highlight"/>
                  <div class="month-cell"/>
                  <div class="month-cell"/>
                </div>
                <div class="month-row">
                  <div class="month-cell"/>
                  <div class="month-cell month-cell--highlight"/>
                  <div class="month-cell"/>
                  <div class="month-cell"/>
                  <div class="month-cell"/>
                  <div class="month-cell"/>
                  <div class="month-cell"/>
                </div>
              </div>
            </div>
            <div class="view-mode-card__content">
              <div class="view-mode-card__title">{{ t('view_mode_month_title') }}</div>
              <div class="view-mode-card__description">{{ t('view_mode_month_description') }}</div>
            </div>
            <div v-if="state.viewMode === 'month'" class="view-mode-card__checkmark">
              <svg xmlns="http://www.w3.org/2000/svg"
                   width="20"
                   height="20"
                   viewBox="0 0 24 24"
                   fill="none"
                   stroke="currentColor"
                   stroke-width="2"
                   stroke-linecap="round"
                   stroke-linejoin="round"
                   aria-hidden="true">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
          </button>
        </div>
      </div>

      <div class="form-group">
        <label for="accentColor" class="form-label">{{ t('accent_color_label') }}</label>
        <div class="form-field">
          <div class="color-picker-wrapper">
            <input
              id="accentColor"
              v-model="state.accentColor"
              type="color"
              class="color-input"
              :aria-invalid="!!state.fieldErrors.accentColor"
              :aria-describedby="state.fieldErrors.accentColor ? 'accentColor-error' : undefined"
              @input="clearFieldError('accentColor')"
            />
            <span class="color-value">{{ state.accentColor }}</span>
          </div>
          <div
            v-if="state.fieldErrors.accentColor"
            id="accentColor-error"
            class="field-error"
            role="alert">
            {{ state.fieldErrors.accentColor }}
          </div>
          <div class="description">{{ t('accent_color_help') }}</div>
        </div>
      </div>

      <div class="form-group">
        <label for="colorMode" class="form-label">{{ t('color_mode_label') }}</label>
        <div class="form-field">
          <select
            id="colorMode"
            v-model="state.colorMode"
            :aria-invalid="!!state.fieldErrors.colorMode"
            :aria-describedby="state.fieldErrors.colorMode ? 'colorMode-error' : undefined"
            @change="clearFieldError('colorMode')"
          >
            <option value="auto">{{ t('color_mode_auto') }}</option>
            <option value="light">{{ t('color_mode_light') }}</option>
            <option value="dark">{{ t('color_mode_dark') }}</option>
          </select>
          <div
            v-if="state.fieldErrors.colorMode"
            id="colorMode-error"
            class="field-error"
            role="alert">
            {{ state.fieldErrors.colorMode }}
          </div>
          <div class="description">{{ t('color_mode_help') }}</div>
        </div>
      </div>

      <div
        v-if="state.fieldErrors.view"
        id="view-error"
        class="field-error"
        role="alert">
        {{ state.fieldErrors.view }}
      </div>

      <div class="form-actions">
        <PillButton
          variant="primary"
          class="save-button"
          :disabled="!isDirty || state.isSaving"
          @click="save"
        >
          {{ state.isSaving ? t('saving') : t('save_button') }}
        </PillButton>
        <div
          v-if="state.successMessage"
          class="alert alert--success"
          role="status"
          aria-live="polite">
          {{ state.successMessage }}
        </div>
        <div
          v-if="state.errorMessage"
          class="alert alert--error"
          role="alert">
          {{ state.errorMessage }}
        </div>
      </div>
    </div>

    <div class="preview-section">
      <h3>{{ t('preview_title') }}</h3>
      <p class="section-description">{{ t('preview_description') }}</p>
      <div class="preview-container">
        <iframe
          ref="iframeRef"
          :src="previewUrl"
          class="widget-preview"
          title="Widget Preview"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, computed, ref, watch, onMounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import axios from 'axios';
import PillButton from '@/client/components/common/pill-button.vue';
import { validateAndEncodeId } from '@/client/service/utils';
import { WIDGET_CONFIG_DEFAULTS } from '@/common/model/widget_config';

// Props
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

// Translations
const { t } = useTranslation('calendars', {
  keyPrefix: 'widget.config',
});

// Component state
const state = reactive({
  viewMode: WIDGET_CONFIG_DEFAULTS.view,
  accentColor: WIDGET_CONFIG_DEFAULTS.accentColor,
  colorMode: WIDGET_CONFIG_DEFAULTS.colorMode,
  isSaving: false,
  successMessage: '',
  errorMessage: '',
  fieldErrors: {
    view: '',
    accentColor: '',
    colorMode: '',
  },
});

// Snapshot of last loaded/saved state for dirty tracking
const snapshot = reactive({
  viewMode: WIDGET_CONFIG_DEFAULTS.view,
  accentColor: WIDGET_CONFIG_DEFAULTS.accentColor,
  colorMode: WIDGET_CONFIG_DEFAULTS.colorMode,
});

// Iframe ref
const iframeRef = ref(null);

// Dirty state: true when any field differs from the loaded snapshot
const isDirty = computed(() => {
  return state.viewMode !== snapshot.viewMode
    || state.accentColor !== snapshot.accentColor
    || state.colorMode !== snapshot.colorMode;
});

// Computed preview URL
const previewUrl = computed(() => {
  const baseUrl = window.location.origin;
  const params = new URLSearchParams({
    view: state.viewMode,
    accentColor: state.accentColor,
    colorMode: state.colorMode,
  });
  return `${baseUrl}/widget/${props.calendarUrlName}?${params.toString()}`;
});

/**
 * Clear the inline error for a specific field when the user edits it.
 */
const setViewMode = (view) => {
  state.viewMode = view;
  clearFieldError('view');
};

const clearFieldError = (field) => {
  if (state.fieldErrors[field]) {
    state.fieldErrors[field] = '';
  }
};

/**
 * Capture the current loaded config as the snapshot used for dirty tracking.
 */
const refreshSnapshot = () => {
  snapshot.viewMode = state.viewMode;
  snapshot.accentColor = state.accentColor;
  snapshot.colorMode = state.colorMode;
};

/**
 * Load widget config for this calendar from the server.
 * On failure, fall back to defaults (already initialized).
 */
const loadConfig = async () => {
  try {
    const encodedId = validateAndEncodeId(props.calendarId, 'Calendar ID');
    const response = await axios.get(`/api/v1/calendars/${encodedId}/widget/config`);
    const data = response.data ?? {};
    state.viewMode = data.view ?? WIDGET_CONFIG_DEFAULTS.view;
    state.accentColor = data.accentColor ?? WIDGET_CONFIG_DEFAULTS.accentColor;
    state.colorMode = data.colorMode ?? WIDGET_CONFIG_DEFAULTS.colorMode;
    refreshSnapshot();
  }
  catch (error) {
    console.error('Error loading widget config:', error);
    state.errorMessage = t('error_loading');
  }
};

/**
 * Save widget config to the server. On success, update the snapshot so the
 * Save button disables again. On 400 with fields, surface inline errors.
 */
const save = async () => {
  state.isSaving = true;
  state.errorMessage = '';
  state.successMessage = '';
  state.fieldErrors.view = '';
  state.fieldErrors.accentColor = '';
  state.fieldErrors.colorMode = '';

  try {
    const encodedId = validateAndEncodeId(props.calendarId, 'Calendar ID');
    const payload = {
      view: state.viewMode,
      accentColor: state.accentColor,
      colorMode: state.colorMode,
    };
    const response = await axios.put(`/api/v1/calendars/${encodedId}/widget/config`, payload);
    const saved = response.data ?? {};
    state.viewMode = saved.view ?? state.viewMode;
    state.accentColor = saved.accentColor ?? state.accentColor;
    state.colorMode = saved.colorMode ?? state.colorMode;
    refreshSnapshot();
    state.successMessage = t('save_success');
  }
  catch (error) {
    console.error('Error saving widget config:', error);
    const fields = error?.response?.data?.fields;
    if (fields && typeof fields === 'object') {
      // Backend fields keyed by camelCase; value may be string or array
      const coerce = (v) => Array.isArray(v) ? v.join(', ') : (typeof v === 'string' ? v : '');
      if (fields.view) state.fieldErrors.view = coerce(fields.view);
      if (fields.accentColor) state.fieldErrors.accentColor = coerce(fields.accentColor);
      if (fields.colorMode) state.fieldErrors.colorMode = coerce(fields.colorMode);
      state.errorMessage = t('save_validation_error');
    }
    else {
      state.errorMessage = t('save_error');
    }
  }
  finally {
    state.isSaving = false;
  }
};

// Watch for configuration changes and send updates to iframe
watch(
  () => [state.viewMode, state.accentColor, state.colorMode],
  () => {
    if (iframeRef.value?.contentWindow) {
      iframeRef.value.contentWindow.postMessage(
        {
          type: 'pavillion:updateConfig',
          config: {
            view: state.viewMode,
            accentColor: state.accentColor,
            colorMode: state.colorMode,
          },
        },
        window.location.origin,
      );
    }
  },
);

// Load config on mount and when calendar id changes
onMounted(loadConfig);
watch(() => props.calendarId, loadConfig);

// Expose state to parent component
defineExpose({
  state,
  isDirty,
  save,
  loadConfig,
});
</script>

<style scoped lang="scss">
@use '../../../assets/style/components/calendar-admin' as *;

.widget-config {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);

  .config-section,
  .preview-section {
    h3 {
      @include admin-section-title;
      font-size: 1rem;
      font-weight: 500;
      margin-bottom: var(--pav-space-3);
    }

    .section-description {
      margin: 0 0 var(--pav-space-4) 0;
      font-size: 0.875rem;
      color: var(--pav-color-stone-600);
      line-height: 1.5;

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-stone-400);
      }
    }
  }

  .form-group {
    margin-bottom: var(--pav-space-6);

    .form-label {
      display: block;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--pav-color-stone-700);
      margin: 0 0 var(--pav-space-3) 0;

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-stone-300);
      }
    }

    .description {
      margin: var(--pav-space-2) 0 0 0;
      font-size: 0.875rem;
      color: var(--pav-color-stone-600);
      line-height: 1.5;

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-stone-400);
      }
    }

    select {
      @include admin-form-input;
      cursor: pointer;
    }
  }

  .view-mode-group {
    .view-mode-cards {
      display: grid;
      grid-template-columns: 1fr;
      gap: var(--pav-space-4);

      @media (min-width: 640px) {
        grid-template-columns: repeat(3, 1fr);
      }
    }

    .view-mode-card {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: var(--pav-space-5);
      background: var(--pav-color-surface-primary);
      border: 2px solid var(--pav-border-primary);
      border-radius: 0.75rem;
      cursor: pointer;
      transition: all 0.2s;

      &:hover {
        border-color: var(--pav-color-stone-400);
      }

      &--selected {
        border-color: var(--pav-color-orange-500);
        background: oklch(0.705 0.213 47.604 / 0.02);

        @media (prefers-color-scheme: dark) {
          background: oklch(0.705 0.213 47.604 / 0.05);
        }
      }

      &__illustration {
        width: 100%;
        height: 80px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: var(--pav-space-4);
      }

      &__content {
        text-align: center;
      }

      &__title {
        font-size: 0.9375rem;
        font-weight: 500;
        color: var(--pav-color-stone-900);
        margin-bottom: var(--pav-space-1);

        @media (prefers-color-scheme: dark) {
          color: var(--pav-color-stone-100);
        }
      }

      &__description {
        font-size: 0.8125rem;
        color: var(--pav-color-stone-600);

        @media (prefers-color-scheme: dark) {
          color: var(--pav-color-stone-400);
        }
      }

      &__checkmark {
        position: absolute;
        top: var(--pav-space-3);
        right: var(--pav-space-3);
        color: var(--pav-color-orange-500);
      }
    }
  }

  .list-illustration {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 80%;

    .list-line {
      height: 12px;
      background: var(--pav-color-stone-300);
      border-radius: 4px;

      @media (prefers-color-scheme: dark) {
        background: var(--pav-color-stone-700);
      }
    }
  }

  .week-illustration {
    display: flex;
    gap: 4px;
    width: 90%;

    .week-day {
      flex: 1;
      height: 60px;
      background: var(--pav-color-stone-200);
      border-radius: 4px;

      @media (prefers-color-scheme: dark) {
        background: var(--pav-color-stone-700);
      }

      &--highlight {
        background: var(--pav-color-orange-200);

        @media (prefers-color-scheme: dark) {
          background: oklch(0.705 0.213 47.604 / 0.3);
        }
      }
    }
  }

  .month-illustration {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 90%;

    .month-row {
      display: flex;
      gap: 4px;
    }

    .month-cell {
      flex: 1;
      height: 24px;
      background: var(--pav-color-stone-200);
      border-radius: 2px;

      @media (prefers-color-scheme: dark) {
        background: var(--pav-color-stone-700);
      }

      &--highlight {
        background: var(--pav-color-orange-200);

        @media (prefers-color-scheme: dark) {
          background: oklch(0.705 0.213 47.604 / 0.3);
        }
      }
    }
  }

  .color-picker-wrapper {
    display: flex;
    align-items: center;
    gap: var(--pav-space-3);

    .color-input {
      width: 60px;
      height: 60px;
      border: 1px solid var(--pav-border-primary);
      border-radius: 0.5rem;
      cursor: pointer;
      transition: all 0.2s ease;

      &:focus {
        outline: none;
        box-shadow: var(--pav-shadow-focus-brand);
        border-color: var(--pav-color-orange-500);
      }
    }

    .color-value {
      font-size: 0.9375rem;
      font-family: monospace;
      color: var(--pav-text-primary);
      font-weight: 500;
    }
  }

  .form-actions {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-3);
    margin-top: var(--pav-space-4);
  }

  .save-button {
    align-self: flex-start;
  }

  .field-error {
    margin-top: var(--pav-space-2);
    font-size: 0.8125rem;
    color: var(--pav-color-red-700);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-red-400);
    }
  }

  .alert {
    padding: var(--pav-space-3);
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

    &.alert--success {
      background-color: rgba(34, 197, 94, 0.1);
      border: 1px solid rgba(34, 197, 94, 0.2);
      color: var(--pav-color-green-700);

      @media (prefers-color-scheme: dark) {
        color: var(--pav-color-green-400);
      }
    }
  }

  .preview-section {
    .preview-container {
      border: 1px solid var(--pav-border-primary);
      border-radius: 0.75rem;
      background: var(--pav-color-stone-100);
      padding: var(--pav-space-4);
      min-height: 600px;

      @media (prefers-color-scheme: dark) {
        background: var(--pav-color-stone-800);
      }

      .widget-preview {
        width: 100%;
        height: 600px;
        border: none;
        border-radius: 0.75rem;
      }
    }
  }
}
</style>
