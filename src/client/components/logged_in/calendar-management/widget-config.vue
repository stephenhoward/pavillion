<template>
  <div class="widget-config">
    <div class="config-section settings">
      <h3>{{ t('configuration_title') }}</h3>
      <p class="section-description">{{ t('configuration_description') }}</p>

      <div class="form-group">
        <label for="viewMode" class="form-label">{{ t('view_mode_label') }}</label>
        <div class="form-field">
          <select
            id="viewMode"
            v-model="state.viewMode"
          >
            <option value="list">{{ t('view_mode_list') }}</option>
            <option value="week">{{ t('view_mode_week') }}</option>
            <option value="month">{{ t('view_mode_month') }}</option>
          </select>
          <div class="description">{{ t('view_mode_help') }}</div>
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
            />
            <span class="color-value">{{ state.accentColor }}</span>
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
          >
            <option value="auto">{{ t('color_mode_auto') }}</option>
            <option value="light">{{ t('color_mode_light') }}</option>
            <option value="dark">{{ t('color_mode_dark') }}</option>
          </select>
          <div class="description">{{ t('color_mode_help') }}</div>
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
import { reactive, computed, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';

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
  viewMode: 'list',
  accentColor: '#ff9131',
  colorMode: 'auto',
});

// Iframe ref
const iframeRef = ref(null);

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

// Expose state to parent component
defineExpose({
  state,
});
</script>

<style scoped lang="scss">
@use '../../../assets/mixins' as *;

.widget-config {
  max-width: 900px;
  margin: 0 auto;

  .config-section,
  .preview-section {
    margin-bottom: $spacing-2xl;

    h3 {
      margin: 0 0 $spacing-sm 0;
      font-size: 18px;
      font-weight: $font-medium;
      color: $light-mode-text;

      @include dark-mode {
        color: $dark-mode-text;
      }
    }

    .section-description {
      margin: 0 0 $spacing-xl 0;
      font-size: 14px;
      color: $light-mode-secondary-text;
      line-height: 1.5;

      @include dark-mode {
        color: $dark-mode-secondary-text;
      }
    }
  }

  .description {
    margin: $spacing-xs 0 0 0;
    font-size: 14px;
    color: $light-mode-secondary-text;
    line-height: 1.5;

    @include dark-mode {
      color: $dark-mode-secondary-text;
    }
  }

  .color-picker-wrapper {
    display: flex;
    align-items: center;
    gap: $spacing-md;

    .color-input {
      width: 80px;
      height: 44px;
      border: 1px solid $light-mode-border;
      border-radius: $component-border-radius-small;
      cursor: pointer;
      transition: all 0.2s ease;

      @include dark-mode {
        border-color: $dark-mode-border;
      }

      &:focus {
        outline: none;
        border-color: $focus-color;
        box-shadow: 0 0 0 3px rgba($focus-color, 0.1);

        @include dark-mode {
          border-color: $focus-color-dark;
          box-shadow: 0 0 0 3px rgba($focus-color-dark, 0.1);
        }
      }
    }

    .color-value {
      font-size: 15px;
      font-family: monospace;
      color: $light-mode-text;
      font-weight: $font-medium;

      @include dark-mode {
        color: $dark-mode-text;
      }
    }
  }

  .preview-section {
    .preview-container {
      border: 1px solid $light-mode-border;
      border-radius: $component-border-radius-small;
      background: $light-mode-panel-background;
      padding: $spacing-lg;
      min-height: 600px;

      @include dark-mode {
        background: $dark-mode-input-background;
        border-color: $dark-mode-border;
      }

      .widget-preview {
        width: 100%;
        height: 600px;
        border: none;
        border-radius: $component-border-radius-small;
      }
    }
  }
}
</style>
