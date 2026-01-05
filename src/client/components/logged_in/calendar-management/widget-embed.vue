<template>
  <div class="widget-embed">
    <div class="embed-code-container">
      <pre class="embed-code"><code>{{ embedCode }}</code></pre>
      <button
        class="copy-btn"
        :disabled="state.copying"
        @click="copyToClipboard"
      >
        {{ state.copied ? t('copied') : t('copy_button') }}
      </button>
    </div>

    <div v-if="state.error" class="error">
      {{ state.error }}
    </div>

    <div v-if="state.copied" class="success">
      {{ t('copy_success') }}
    </div>
  </div>
</template>

<script setup>
import { reactive, computed } from 'vue';
import { useTranslation } from 'i18next-vue';

// Props
const props = defineProps({
  calendarUrlName: {
    type: String,
    required: true,
  },
  viewMode: {
    type: String,
    default: 'list',
  },
  accentColor: {
    type: String,
    default: '#ff9131',
  },
  colorMode: {
    type: String,
    default: 'auto',
  },
});

// Translations
const { t } = useTranslation('calendars', {
  keyPrefix: 'widget.embed',
});

// Component state
const state = reactive({
  copying: false,
  copied: false,
  error: '',
});

// Generate embed code
const embedCode = computed(() => {
  const baseUrl = window.location.origin;
  return `<div id="calendar-widget"></div>
<script async src="${baseUrl}/widget/pavillion-widget.js"><\/script>
<script>
  window.Pavillion = window.Pavillion || { q: [] };
  Pavillion('init', {
    calendar: '${props.calendarUrlName}',
    container: '#calendar-widget',
    view: '${props.viewMode}',
    accentColor: '${props.accentColor}',
    colorMode: '${props.colorMode}'
  });
<\/script>`;
});

/**
 * Copy embed code to clipboard
 */
const copyToClipboard = async () => {
  try {
    state.copying = true;
    state.error = '';
    state.copied = false;

    await navigator.clipboard.writeText(embedCode.value);
    state.copied = true;

    setTimeout(() => {
      state.copied = false;
    }, 3000);
  }
  catch (error) {
    console.error('Error copying to clipboard:', error);
    state.error = t('copy_error');
  }
  finally {
    state.copying = false;
  }
};
</script>

<style scoped lang="scss">
@use '../../../assets/mixins' as *;

.widget-embed {
  max-width: 800px;
  margin: 0 auto;

  .embed-code-container {
    position: relative;
    margin-bottom: $spacing-lg;

    .embed-code {
      margin: 0;
      padding: $spacing-lg;
      background: rgb(247, 247, 247);
      border: 1px solid $light-mode-border;
      border-radius: $component-border-radius-small;
      overflow-x: auto;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 13px;
      line-height: 1.6;
      color: rgb(51, 51, 51);

      @include dark-mode {
        background: rgb(30, 30, 30);
        border-color: $dark-mode-border;
        color: rgb(220, 220, 220);
      }

      code {
        font-family: inherit;
        white-space: pre;
      }
    }

    .copy-btn {
      position: absolute;
      top: $spacing-md;
      right: $spacing-md;
      padding: $spacing-sm $spacing-lg;
      background: $light-mode-button-background;
      color: white;
      border: none;
      border-radius: $component-border-radius-small;
      font-size: 14px;
      font-weight: $font-medium;
      cursor: pointer;
      transition: all 0.2s ease;
      min-height: 36px;

      @include dark-mode {
        background: $dark-mode-button-background;
        color: white;
      }

      &:hover:not(:disabled) {
        opacity: 0.9;
      }

      &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    }
  }

  .error {
    padding: $spacing-lg;
    margin-bottom: $spacing-lg;
    background-color: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.25);
    border-radius: $component-border-radius-small;
    color: rgb(153, 27, 27);
    font-size: 14px;
    line-height: 1.4;
    border-left: 4px solid rgba(239, 68, 68, 0.5);
    animation: slideIn 0.3s ease;

    @include dark-mode {
      background-color: rgba(239, 68, 68, 0.15);
      border-color: rgba(239, 68, 68, 0.3);
      color: rgb(248, 113, 113);
    }

    &::before {
      content: '⚠️';
      margin-right: $spacing-sm;
    }
  }

  .success {
    padding: $spacing-lg;
    margin-bottom: $spacing-lg;
    background-color: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.25);
    border-radius: $component-border-radius-small;
    color: rgb(21, 128, 61);
    font-size: 14px;
    line-height: 1.4;
    border-left: 4px solid rgba(34, 197, 94, 0.5);
    animation: slideIn 0.3s ease;

    @include dark-mode {
      background-color: rgba(34, 197, 94, 0.15);
      border-color: rgba(34, 197, 94, 0.3);
      color: rgb(74, 222, 128);
    }

    &::before {
      content: '✅';
      margin-right: $spacing-sm;
    }
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
}
</style>
