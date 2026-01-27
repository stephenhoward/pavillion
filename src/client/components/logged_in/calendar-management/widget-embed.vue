<template>
  <div class="widget-embed">
    <div class="embed-header">
      <button
        class="copy-btn"
        :disabled="state.copying"
        @click="copyToClipboard"
      >
        {{ state.copied ? t('copied') : t('copy_button') }}
      </button>
    </div>

    <pre class="embed-code"><code>{{ embedCode }}</code></pre>

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
.widget-embed {
  max-width: 800px;
  margin: 0 auto;

  .embed-header {
    display: flex;
    justify-content: flex-end;
    margin-bottom: var(--pav-space-3);
  }

  .copy-btn {
    padding: var(--pav-space-2) var(--pav-space-4);
    background: var(--pav-color-orange-500);
    color: white;
    border: none;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    min-height: 36px;

    @media (prefers-color-scheme: dark) {
      background: var(--pav-color-orange-600);
      color: white;
    }

    &:hover:not(:disabled) {
      background: var(--pav-color-orange-600);

      @media (prefers-color-scheme: dark) {
        background: var(--pav-color-orange-500);
      }
    }

    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }

  .embed-code {
    margin: 0 0 var(--pav-space-4) 0;
    padding: var(--pav-space-4);
    background: var(--pav-color-stone-50);
    border: 1px solid var(--pav-border-primary);
    border-radius: 0.75rem;
    overflow-x: auto;
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 0.8125rem;
    line-height: 1.6;
    color: var(--pav-color-stone-900);

    @media (min-width: 640px) {
      padding: var(--pav-space-6);
      font-size: 0.875rem;
    }

    @media (prefers-color-scheme: dark) {
      background: var(--pav-color-stone-800);
      border-color: var(--pav-color-stone-700);
      color: var(--pav-color-stone-100);
    }

    code {
      font-family: inherit;
      white-space: pre-wrap;
      word-break: break-all;
    }
  }

  .error {
    padding: var(--pav-space-4);
    margin-bottom: var(--pav-space-4);
    background-color: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.25);
    border-radius: 6px;
    color: rgb(153, 27, 27);
    font-size: 14px;
    line-height: 1.4;
    border-left: 4px solid rgba(239, 68, 68, 0.5);
    animation: slideIn 0.3s ease;

    @media (prefers-color-scheme: dark) {
      background-color: rgba(239, 68, 68, 0.15);
      border-color: rgba(239, 68, 68, 0.3);
      color: rgb(248, 113, 113);
    }

    &::before {
      content: '⚠️';
      margin-right: var(--pav-space-2);
    }
  }

  .success {
    padding: var(--pav-space-4);
    margin-bottom: var(--pav-space-4);
    background-color: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.25);
    border-radius: 6px;
    color: rgb(21, 128, 61);
    font-size: 14px;
    line-height: 1.4;
    border-left: 4px solid rgba(34, 197, 94, 0.5);
    animation: slideIn 0.3s ease;

    @media (prefers-color-scheme: dark) {
      background-color: rgba(34, 197, 94, 0.15);
      border-color: rgba(34, 197, 94, 0.3);
      color: rgb(74, 222, 128);
    }

    &::before {
      content: '✅';
      margin-right: var(--pav-space-2);
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
