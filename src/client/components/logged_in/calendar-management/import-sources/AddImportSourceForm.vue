<template>
  <form
    class="add-import-source-form"
    novalidate
    @submit.prevent="onSubmit"
  >
    <fieldset :disabled="isSubmitting" class="add-import-source-form__fieldset">
      <!--
        The visible heading is provided by the parent ModalLayout's title,
        so the legend is visually hidden but kept for fieldset semantics.
      -->
      <legend class="sr-only">
        {{ t('add_fieldset_legend') }}
      </legend>

      <!-- Tab header: choose how to add the import source -->
      <div
        role="tablist"
        :aria-label="t('tabs_aria_label')"
        class="add-import-source-form__tabs"
        @keydown="handleTabKeydown"
      >
        <button
          :id="urlTabId"
          type="button"
          role="tab"
          class="add-import-source-form__tab"
          :aria-selected="activeTab === 'url' ? 'true' : 'false'"
          :aria-controls="urlPanelId"
          :tabindex="activeTab === 'url' ? 0 : -1"
          @click="selectTab('url')"
        >
          {{ t('tab_url') }}
        </button>
        <button
          :id="fileTabId"
          type="button"
          role="tab"
          class="add-import-source-form__tab"
          :aria-selected="activeTab === 'file' ? 'true' : 'false'"
          :aria-controls="filePanelId"
          :tabindex="activeTab === 'file' ? 0 : -1"
          @click="selectTab('file')"
        >
          {{ t('tab_file') }}
        </button>
      </div>

      <div v-if="errorMessage" class="alert alert--error" role="alert">
        {{ errorMessage }}
      </div>

      <!-- From URL tab panel (existing field set, unchanged) -->
      <div
        :id="urlPanelId"
        role="tabpanel"
        :aria-labelledby="urlTabId"
        :hidden="activeTab !== 'url'"
        :aria-hidden="activeTab === 'url' ? 'false' : 'true'"
        class="add-import-source-form__panel"
      >
        <div class="form-group">
          <label :for="urlInputId" class="form-group__label">
            {{ t('url_label') }}
          </label>
          <input
            :id="urlInputId"
            ref="urlInputRef"
            v-model="url"
            type="url"
            class="form-group__input"
            :placeholder="t('url_placeholder')"
            :aria-describedby="urlDescribedBy"
            :aria-invalid="!!validationError"
            required
          />
          <p :id="urlHelpId" class="form-group__help">
            {{ t('url_help') }}
          </p>
          <p
            v-if="validationError"
            :id="validationErrorId"
            class="form-group__error"
            role="alert"
          >
            {{ validationError }}
          </p>
        </div>
      </div>

      <!-- Upload file tab panel -->
      <div
        :id="filePanelId"
        role="tabpanel"
        :aria-labelledby="fileTabId"
        :hidden="activeTab !== 'file'"
        :aria-hidden="activeTab === 'file' ? 'false' : 'true'"
        class="add-import-source-form__panel"
      >
        <div class="form-group">
          <label :for="fileInputId" class="form-group__label">
            {{ t('file_label') }}
          </label>
          <input
            :id="fileInputId"
            ref="fileInputRef"
            type="file"
            accept=".ics,text/calendar"
            class="form-group__file-input"
            :aria-describedby="fileDescribedBy"
            :aria-invalid="!!fileValidationError"
            required
            @change="onFileChange"
          />
          <p :id="fileHelpId" class="form-group__help">
            {{ t('file_help') }}
          </p>

          <div
            v-if="selectedFile"
            class="add-import-source-form__file-summary"
            aria-live="polite"
          >
            <span class="add-import-source-form__file-meta">
              <span class="add-import-source-form__file-name">{{ selectedFile.name }}</span>
              <span class="add-import-source-form__file-size">{{ formattedFileSize }}</span>
            </span>
            <button
              type="button"
              class="btn-ghost btn-ghost--danger"
              @click="removeFile"
            >
              {{ t('file_remove') }}
            </button>
          </div>

          <p
            v-if="fileValidationError"
            :id="fileErrorId"
            class="form-group__error"
            role="alert"
          >
            {{ fileValidationError }}
          </p>
        </div>
      </div>

      <div class="add-import-source-form__actions">
        <button
          type="button"
          class="btn-ghost"
          :disabled="isSubmitting"
          @click="onCancel"
        >
          {{ t('cancel_button') }}
        </button>
        <PillButton
          variant="primary"
          type="submit"
          :disabled="isSubmitting || !canSubmit"
        >
          {{ isSubmitting ? t('adding') : t('add_submit_button') }}
        </PillButton>
      </div>
    </fieldset>
  </form>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { useTranslation } from 'i18next-vue';

import PillButton from '@/client/components/common/pill-button.vue';
import { useTabNavigation } from '@/client/composables/useTabNavigation';

/**
 * The form submits one of two source types. The parent (ImportSourcesSection)
 * discriminates on `type` to create either a URL-backed or file-backed source.
 * Exported so the parent can import the emit contract rather than re-declaring
 * it, keeping both sides tied together at compile time.
 */
export type SubmitPayload =
  | { type: 'url'; url: string }
  | { type: 'file'; file: File };

type TabKey = 'url' | 'file';

// A calendar file must be <= 10 MiB. Kept in bytes for direct size comparison.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const props = defineProps<{
  isSubmitting?: boolean;
  errorMessage?: string | null;
  autofocus?: boolean;
}>();

const emit = defineEmits<{
  (event: 'submit', payload: SubmitPayload): void;
  (event: 'cancel'): void;
}>();

const { t } = useTranslation('calendars', { keyPrefix: 'import' });

const activeTab = ref<TabKey>('url');

const url = ref('');
const validationError = ref<string | null>(null);
const urlInputRef = ref<HTMLInputElement | null>(null);

const selectedFile = ref<File | null>(null);
const fileValidationError = ref<string | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

// Unique ids so multiple instances of the form don't collide. The tab-button
// ids are the exception: useTabNavigation resolves the focus target via
// document.getElementById(`${tabName}-tab`), so those must be `url-tab` /
// `file-tab` to match the ordered tab keys below.
const uid = Math.random().toString(36).slice(2, 10);
const urlTabId = 'url-tab';
const fileTabId = 'file-tab';
const urlPanelId = computed(() => `import-source-url-panel-${uid}`);
const filePanelId = computed(() => `import-source-file-panel-${uid}`);
const urlInputId = computed(() => `import-source-url-${uid}`);
const urlHelpId = computed(() => `import-source-url-help-${uid}`);
const validationErrorId = computed(() => `import-source-url-error-${uid}`);
const fileInputId = computed(() => `import-source-file-${uid}`);
const fileHelpId = computed(() => `import-source-file-help-${uid}`);
const fileErrorId = computed(() => `import-source-file-error-${uid}`);

// Wire each input's error paragraph into aria-describedby when present,
// alongside the persistent help text, so screen readers announce both.
const urlDescribedBy = computed(() =>
  [urlHelpId.value, validationError.value ? validationErrorId.value : null]
    .filter(Boolean)
    .join(' '),
);
const fileDescribedBy = computed(() =>
  [fileHelpId.value, fileValidationError.value ? fileErrorId.value : null]
    .filter(Boolean)
    .join(' '),
);

const formattedFileSize = computed(() => formatBytes(selectedFile.value?.size ?? 0));

// The submit button is enabled once the active tab has a candidate value and
// no known validation error. Final validation still runs on submit.
const canSubmit = computed(() => {
  if (activeTab.value === 'url') {
    return !!url.value.trim();
  }
  return !!selectedFile.value && !fileValidationError.value;
});

const selectTab = (tab: TabKey): void => {
  activeTab.value = tab;
};

// Ordered tab keys drive roving-tabindex arrow-key navigation. The shared
// composable handles ArrowLeft/Right/Home/End for this horizontal tablist,
// focusing each tab's button (resolved by `${tabName}-tab` id) and activating
// it. This is the same wiring the parent calendar-management root.vue uses.
const orderedTabs: TabKey[] = ['url', 'file'];
const { handleTabKeydown } = useTabNavigation(
  orderedTabs,
  activeTab,
  (tab) => selectTab(tab as TabKey),
);

/** Human-readable byte size using binary units. */
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(1)} KiB`;
  }
  return `${(kib / 1024).toFixed(1)} MiB`;
};

/**
 * Validate a selected calendar file. Returns a localized error string, or null
 * when the file is acceptable (selected, <= 10 MiB, .ics extension or a
 * calendar MIME type).
 */
const validateFile = (file: File | null): string | null => {
  if (!file) {
    return t('file_required');
  }
  if (file.size > MAX_FILE_BYTES) {
    return t('file_too_large');
  }
  const hasIcsExtension = file.name.toLowerCase().endsWith('.ics');
  const hasCalendarMime = file.type === 'text/calendar';
  if (!hasIcsExtension && !hasCalendarMime) {
    return t('file_invalid_type');
  }
  return null;
};

const onFileChange = (event: Event): void => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  selectedFile.value = file;
  fileValidationError.value = file ? validateFile(file) : null;
};

const removeFile = (): void => {
  selectedFile.value = null;
  fileValidationError.value = null;
  // Removing the file unmounts the summary block that holds this button, so
  // move focus to a stable target (the file input) to satisfy WCAG 2.4.3
  // rather than letting focus fall to <body>.
  if (fileInputRef.value) {
    fileInputRef.value.value = '';
    fileInputRef.value.focus();
  }
};

const submitUrl = (): void => {
  validationError.value = null;
  const trimmed = url.value.trim();
  if (!trimmed) {
    validationError.value = t('url_required');
    return;
  }
  emit('submit', { type: 'url', url: trimmed });
};

const submitFile = (): void => {
  const error = validateFile(selectedFile.value);
  fileValidationError.value = error;
  if (error || !selectedFile.value) {
    return;
  }
  emit('submit', { type: 'file', file: selectedFile.value });
};

const onSubmit = (): void => {
  if (activeTab.value === 'url') {
    submitUrl();
  }
  else {
    submitFile();
  }
};

const onCancel = () => {
  if (props.isSubmitting) {
    return;
  }
  emit('cancel');
};

onMounted(async () => {
  if (props.autofocus) {
    await nextTick();
    urlInputRef.value?.focus();
  }
});
</script>

<style scoped lang="scss">
@use '../../../../assets/style/components/calendar-admin' as *;
@use '../../../../assets/style/mixins/tabs' as *;
@use '../../../../assets/style/mixins/visibility' as *;

.sr-only {
  @include sr-only;
}

.add-import-source-form {
  &__fieldset {
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-4);
  }

  &__tabs {
    @include tab-navigation;
    gap: var(--pav-space-6);
    margin-bottom: 0;
  }

  &__tab {
    @include tab-button;
  }

  &__panel {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-4);

    // The inactive tab panel carries the [hidden] attribute, whose UA
    // `display: none` is overridden by the author `display: flex` above —
    // without this rule both panels (URL input + file chooser) render at
    // once and the tabs become cosmetic. Restore the hidden semantics so a
    // panel is shown only when its tab is active.
    &[hidden] {
      display: none;
    }
  }

  &__file-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--pav-space-3);
    padding: var(--pav-space-2) var(--pav-space-3);
    border-radius: 0.75rem;
    background: var(--pav-color-stone-100);

    @media (prefers-color-scheme: dark) {
      background: var(--pav-color-stone-800);
    }
  }

  &__file-meta {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-1);
    min-width: 0;
  }

  &__file-name {
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--pav-color-stone-900);
    overflow-wrap: anywhere;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }

  &__file-size {
    font-size: 0.8125rem;
    color: var(--pav-color-stone-600);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  &__actions {
    display: flex;
    gap: var(--pav-space-3);
    justify-content: flex-end;
    margin-top: var(--pav-space-2);
  }
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-2);

  &__label {
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--pav-color-stone-700);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-300);
    }
  }

  &__input {
    width: 100%;
    max-width: 32rem;
    padding: 0.75rem 1rem;
    border: 0;
    border-radius: 0.75rem;
    background: var(--pav-color-stone-100);
    color: var(--pav-color-stone-900);
    font-size: 1rem;
    transition: box-shadow 0.2s;

    &:focus {
      outline: none;
      box-shadow: 0 0 0 2px var(--pav-color-orange-500);
    }

    &[aria-invalid='true'] {
      box-shadow: 0 0 0 2px var(--pav-color-red-500);
    }

    @media (prefers-color-scheme: dark) {
      background: var(--pav-color-stone-800);
      color: var(--pav-color-stone-100);
    }
  }

  &__file-input {
    font-size: 0.875rem;
    color: var(--pav-color-stone-700);

    &:focus-visible {
      outline: 2px solid var(--pav-color-orange-500);
      outline-offset: 2px;
      border-radius: var(--pav-border-radius-xs);
    }

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-300);
    }
  }

  &__help {
    margin: 0;
    color: var(--pav-color-stone-600);
    font-size: 0.875rem;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  &__error {
    margin: 0;
    color: var(--pav-color-red-600);
    font-size: 0.875rem;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-red-400);
    }
  }
}

// admin-ghost-button also emits the `&--danger` modifier, so `.btn-ghost--danger`
// (the Remove button) is styled without a separate block.
.btn-ghost {
  @include admin-ghost-button;
}
</style>
