<script setup lang="ts">
import { ref, reactive, computed, inject, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useTranslation } from 'i18next-vue';
import ReportService from '@/client/service/report';
import { DuplicateReportError, ReportValidationError } from '@/common/exceptions/report';
import { EventNotFoundError } from '@/common/exceptions/calendar';
import { ReportCategory } from '@/common/model/report';

const { t } = useTranslation('system', {
  keyPrefix: 'report',
});

const props = defineProps<{
  eventId: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

/** Maximum allowed length for report description text. */
const MAX_DESCRIPTION_LENGTH = 2000;

/** Unique ID for accessible label association. */
const dialogId = Math.random().toString(36).substring(2, 11);
const titleId = `report-dialog-title-${dialogId}`;

const dialogRef = ref<HTMLDialogElement | null>(null);
const categoryRef = ref<HTMLSelectElement | null>(null);

/** Reference to the element that triggered the modal, for focus restoration. */
let triggerElement: HTMLElement | null = null;

const reportService = new ReportService();

/** Authentication service injected from the client app. */
const authn = inject<{ userEmail: () => string | null }>('authn');

/** The current user's email address, displayed as read-only. */
const userEmail = computed(() => authn?.userEmail() ?? '');

/** Category options derived from the ReportCategory enum. */
const categoryOptions = [
  { value: ReportCategory.SPAM, labelKey: 'category_spam' },
  { value: ReportCategory.INAPPROPRIATE, labelKey: 'category_inappropriate' },
  { value: ReportCategory.MISLEADING, labelKey: 'category_misleading' },
  { value: ReportCategory.HARASSMENT, labelKey: 'category_harassment' },
  { value: ReportCategory.OTHER, labelKey: 'category_other' },
];

const form = reactive({
  category: '',
  description: '',
});

const state = reactive({
  isSubmitting: false,
  isSuccess: false,
  error: '',
});

/** Number of characters remaining for the description field. */
const descriptionCharsRemaining = computed(() => {
  return MAX_DESCRIPTION_LENGTH - form.description.length;
});

/**
 * Opens the modal dialog and focuses the first field.
 */
function open() {
  triggerElement = document.activeElement as HTMLElement;
  if (dialogRef.value && !dialogRef.value.open) {
    dialogRef.value.showModal();
    document.body.classList.add('modal-open');
    nextTick(() => {
      categoryRef.value?.focus();
    });
  }
}

/**
 * Closes the modal dialog and restores focus to the trigger.
 */
function close() {
  if (dialogRef.value && dialogRef.value.open) {
    dialogRef.value.close();
  }
  document.body.classList.remove('modal-open');
  resetForm();
  emit('close');
  // Restore focus to the element that opened the modal
  nextTick(() => {
    triggerElement?.focus();
  });
}

/**
 * Handles backdrop clicks to close the modal.
 */
function handleBackdropClick(event: MouseEvent) {
  if (event.target === dialogRef.value) {
    close();
  }
}

/**
 * Resets form fields and state to initial values.
 */
function resetForm() {
  form.category = '';
  form.description = '';
  state.isSubmitting = false;
  state.isSuccess = false;
  state.error = '';
}

/**
 * Validates form fields before submission.
 * No email validation needed for authenticated users.
 *
 * @returns true if the form is valid
 */
function validate(): boolean {
  if (!form.category || !form.description.trim()) {
    state.error = t('error_validation');
    return false;
  }
  if (form.description.trim().length > MAX_DESCRIPTION_LENGTH) {
    state.error = t('error_description_too_long');
    return false;
  }
  return true;
}

/**
 * Submits the report via the report service.
 * No email parameter needed; the server uses JWT identity.
 */
async function handleSubmit() {
  state.error = '';

  if (!validate()) {
    return;
  }

  state.isSubmitting = true;

  try {
    await reportService.submitReport(
      props.eventId,
      form.category,
      form.description.trim(),
    );

    state.isSuccess = true;
  }
  catch (error: unknown) {
    if (error instanceof DuplicateReportError) {
      state.error = t('error_duplicate');
    }
    else if (error instanceof EventNotFoundError) {
      state.error = t('error_not_found');
    }
    else if (error instanceof ReportValidationError) {
      state.error = error.message !== 'Invalid report data'
        ? error.message
        : t('error_validation');
    }
    else {
      state.error = t('error_generic');
    }
  }
  finally {
    state.isSubmitting = false;
  }
}

onMounted(() => {
  open();
});

onBeforeUnmount(() => {
  document.body.classList.remove('modal-open');
});

defineExpose({ open, close, state });
</script>

<template>
  <dialog
    ref="dialogRef"
    class="report-dialog"
    :aria-labelledby="titleId"
    :aria-modal="true"
    @keydown.esc="close"
    @click="handleBackdropClick"
  >
    <div class="report-dialog__content">
      <header class="report-dialog__header">
        <h2 :id="titleId">{{ t('form_title') }}</h2>
        <button
          type="button"
          class="btn btn--ghost report-dialog__close"
          :aria-label="t('close_dialog')"
          @click="close"
        >&times;</button>
      </header>

      <!-- Success State -->
      <div
        v-if="state.isSuccess"
        class="report-dialog__success"
        role="status"
      >
        <p>{{ t('success_message') }}</p>
        <button
          type="button"
          class="btn btn--secondary"
          @click="close"
        >{{ t('cancel_button') }}</button>
      </div>

      <!-- Form State -->
      <form
        v-else
        @submit.prevent="handleSubmit"
        novalidate
      >
        <div
          v-if="state.error"
          class="alert alert--error alert--sm"
          role="alert"
          aria-live="polite"
        >
          {{ state.error }}
        </div>

        <div class="form__group">
          <label
            class="form__label"
            :for="`report-category-${dialogId}`"
          >
            {{ t('category_label') }} <span aria-hidden="true">*</span>
          </label>
          <select
            :id="`report-category-${dialogId}`"
            ref="categoryRef"
            v-model="form.category"
            class="select"
            required
            :disabled="state.isSubmitting"
          >
            <option
              value=""
              disabled
            >{{ t('category_label') }}</option>
            <option
              v-for="option in categoryOptions"
              :key="option.value"
              :value="option.value"
            >{{ t(option.labelKey) }}</option>
          </select>
        </div>

        <div class="form__group">
          <label
            class="form__label"
            :for="`report-description-${dialogId}`"
          >
            {{ t('description_label') }} <span aria-hidden="true">*</span>
          </label>
          <textarea
            :id="`report-description-${dialogId}`"
            v-model="form.description"
            class="textarea"
            :placeholder="t('description_placeholder')"
            :maxlength="MAX_DESCRIPTION_LENGTH"
            rows="4"
            required
            :disabled="state.isSubmitting"
            :aria-describedby="`report-description-counter-${dialogId}`"
          />
          <p
            :id="`report-description-counter-${dialogId}`"
            class="form__help report-dialog__char-counter"
            :class="{ 'report-dialog__char-counter--warning': descriptionCharsRemaining <= 100 }"
            aria-live="polite"
          >{{ t('description_char_count', { remaining: descriptionCharsRemaining, max: MAX_DESCRIPTION_LENGTH }) }}</p>
        </div>

        <!-- Email display (read-only for authenticated users) -->
        <div class="form__group">
          <label
            class="form__label"
            :for="`report-email-${dialogId}`"
          >
            {{ t('email_label') }}
          </label>
          <div
            :id="`report-email-${dialogId}`"
            class="input report-dialog__email-display"
          >{{ userEmail }}</div>
        </div>

        <footer class="report-dialog__actions">
          <button
            type="button"
            class="btn btn--secondary"
            :disabled="state.isSubmitting"
            @click="close"
          >{{ t('cancel_button') }}</button>
          <button
            type="submit"
            class="btn btn--primary"
            :disabled="state.isSubmitting"
          >{{ state.isSubmitting ? t('submitting_button') : t('submit_button') }}</button>
        </footer>
      </form>
    </div>
  </dialog>
</template>

<style scoped lang="scss">
// ================================================================
// REPORT EVENT DIALOG (Client / Authenticated)
// ================================================================
// A modal dialog for authenticated users to report an event.
// Uses the native <dialog> element for built-in accessibility.
// Leverages the design system tokens for theming (auto dark mode).
// Only component-specific layout styles remain here.
// ================================================================

.report-dialog {
  position: fixed;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  overflow: auto;
  z-index: var(--pav-z-index-modal);

  &::backdrop {
    background-color: rgb(0 0 0 / 50%);
    backdrop-filter: blur(4px);
  }
}

.report-dialog__content {
  margin-block-start: 10vh;
  margin-inline: auto;
  padding: var(--pav-space-xl);
  width: 100%;
  max-width: 480px;
  background-color: var(--pav-surface-primary);
  border-radius: var(--pav-border-radius-modal);
  border: var(--pav-border-width-1) solid var(--pav-border-primary);
  box-shadow: var(--pav-shadow-modal);

  @media (max-width: 768px) {
    margin: var(--pav-space-md);
    max-width: calc(100% - var(--pav-space-xl));
  }
}

.report-dialog__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-block-end: var(--pav-space-xl);
  padding-block-end: var(--pav-space-md);
  border-block-end: var(--pav-border-width-1) solid var(--pav-border-subtle);

  h2 {
    margin: 0;
    font-size: var(--pav-font-size-h6);
    font-weight: var(--pav-font-weight-semibold);
    color: var(--pav-text-primary);
  }
}

.report-dialog__close {
  font-size: var(--pav-font-size-xl);
  line-height: 1;
  min-width: 44px;
  min-height: 44px;
}

.report-dialog__success {
  text-align: center;
  padding-block: var(--pav-space-xl);

  p {
    font-size: var(--pav-font-size-body);
    color: var(--pav-color-success);
    margin: 0 0 var(--pav-space-xl) 0;
    line-height: var(--pav-line-height-relaxed);
  }
}

.report-dialog__email-display {
  background-color: var(--pav-surface-tertiary);
  color: var(--pav-text-muted);
  cursor: default;
}

.report-dialog__char-counter {
  text-align: end;
}

.report-dialog__char-counter--warning {
  color: var(--pav-color-error);
}

.report-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--pav-space-md);
  margin-block-start: var(--pav-space-xl);
  padding-block-start: var(--pav-space-lg);
  border-block-start: var(--pav-border-width-1) solid var(--pav-border-subtle);
}

// Required asterisk color
.form__label span {
  color: var(--pav-color-error);
}

// Prevent background scroll when modal is open
:global(body.modal-open) {
  overflow: hidden;
}
</style>
