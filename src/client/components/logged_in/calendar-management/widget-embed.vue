<template>
  <div class="widget-embed">
    <div class="embed-header">
      <CopyButton
        :text="embedCode"
        :label="t('copy_button')"
        :copied-label="t('copied')"
        :feedback-ms="3000"
        :with-icon="false"
        variant="primary"
        @copied="onCopied"
        @error="onCopyError"
      />
    </div>

    <pre class="embed-code"><code>{{ embedCode }}</code></pre>

    <div
      v-if="state.error"
      class="error"
      role="alert"
      aria-live="polite"
    >
      {{ state.error }}
    </div>

    <div
      v-if="state.copied"
      class="success"
      role="status"
      aria-live="polite"
    >
      {{ t('copy_success') }}
    </div>
  </div>
</template>

<script setup>
import { reactive, computed } from 'vue';
import { useTranslation } from 'i18next-vue';

import CopyButton from '@/client/components/common/CopyButton.vue';

// Props
const props = defineProps({
  calendarUrlName: {
    type: String,
    required: true,
  },
});

// Translations
const { t } = useTranslation('calendars', {
  keyPrefix: 'widget.embed',
});

// Component state
const state = reactive({
  copied: false,
  error: '',
});

// Generate embed code
const embedCode = computed(() => {
  const baseUrl = window.location.origin;
  return `<div id="calendar-widget"></div>
<script async src="${baseUrl}/widget/pavillion-widget.js"><\/script>
<script>
  window.Pavillion = window.Pavillion || function(){(window.Pavillion.q=window.Pavillion.q||[]).push([].slice.call(arguments))};
  Pavillion('init', {
    calendar: '${props.calendarUrlName}',
    container: '#calendar-widget'
  });
<\/script>`;
});

const onCopied = () => {
  state.error = '';
  state.copied = true;
  setTimeout(() => {
    state.copied = false;
  }, 3000);
};

const onCopyError = (err) => {
  console.error('Error copying to clipboard:', err);
  state.error = t('copy_error');
  state.copied = false;
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

  .embed-code {
    margin: 0 0 var(--pav-space-4) 0;
    padding: var(--pav-space-4);
    background: var(--pav-surface-card);
    border: 1px solid var(--pav-border-primary);
    border-radius: 0.75rem;
    overflow-x: auto;
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 0.8125rem;
    line-height: 1.6;
    color: var(--pav-text-primary);

    @media (min-width: 640px) {
      padding: var(--pav-space-6);
      font-size: 0.875rem;
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
    background-color: var(--pav-surface-error);
    border: 1px solid var(--pav-border-error-subtle);
    border-radius: 6px;
    color: var(--pav-text-error);
    font-size: 14px;
    line-height: 1.4;
    border-left: 4px solid var(--pav-border-error);
    animation: slideIn 0.3s ease;

    &::before {
      content: '⚠️';
      margin-right: var(--pav-space-2);
    }
  }

  .success {
    padding: var(--pav-space-4);
    margin-bottom: var(--pav-space-4);
    background-color: var(--pav-color-alert-success-bg);
    border: 1px solid var(--pav-color-success);
    border-radius: 6px;
    color: var(--pav-color-alert-success-text);
    font-size: 14px;
    line-height: 1.4;
    border-left: 4px solid var(--pav-color-success);
    animation: slideIn 0.3s ease;

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
