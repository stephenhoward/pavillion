<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useTranslation } from 'i18next-vue';
import ReportService from '@/site/service/report';
import { DuplicateReportError, RateLimitError, ReportValidationError } from '@/common/exceptions/report';
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
  email: '',
});

const state = reactive({
  isSubmitting: false,
  isSuccess: false,
  error: '',
});

/** Per-field validation error messages. */
const fieldErrors = reactive({
  category: '',
  description: '',
  email: '',
});

/** Number of characters remaining for the description field. */
const descriptionCharsRemaining = computed(() => {
  return MAX_DESCRIPTION_LENGTH - form.description.length;
});

/** Basic email format validation. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  form.email = '';
  state.isSubmitting = false;
  state.isSuccess = false;
  state.error = '';
  fieldErrors.category = '';
  fieldErrors.description = '';
  fieldErrors.email = '';
}

/**
 * Validates form fields before submission.
 * Sets per-field error messages for any invalid fields.
 *
 * @returns true if the form is valid
 */
function validate(): boolean {
  // Reset per-field errors before re-validating
  fieldErrors.category = '';
  fieldErrors.description = '';
  fieldErrors.email = '';

  let isValid = true;

  if (!form.category) {
    fieldErrors.category = t('field_error_category');
    isValid = false;
  }

  if (!form.description.trim()) {
    fieldErrors.description = t('field_error_description');
    isValid = false;
  }
  else if (form.description.trim().length > MAX_DESCRIPTION_LENGTH) {
    fieldErrors.description = t('error_description_too_long');
    isValid = false;
  }

  if (!form.email.trim()) {
    fieldErrors.email = t('field_error_email');
    isValid = false;
  }
  else if (!EMAIL_REGEX.test(form.email.trim())) {
    fieldErrors.email = t('field_error_email');
    isValid = false;
  }

  if (!isValid) {
    state.error = t('error_validation');
  }

  return isValid;
}

/**
 * Submits the report via the report service.
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
      form.email.trim().toLowerCase(),
    );

    state.isSuccess = true;
  }
  catch (error: unknown) {
    if (error instanceof DuplicateReportError) {
      state.error = t('error_duplicate');
    }
    else if (error instanceof RateLimitError) {
      state.error = t('error_rate_limit');
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

defineExpose({ open, close });
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
          class="report-dialog__close"
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
          class="report-dialog__btn report-dialog__btn--ghost"
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
          class="report-dialog__error"
          role="alert"
        >
          {{ state.error }}
        </div>

        <div class="report-dialog__field">
          <label :for="`report-category-${dialogId}`">
            {{ t('category_label') }} <span aria-hidden="true">*</span>
          </label>
          <select
            :id="`report-category-${dialogId}`"
            ref="categoryRef"
            v-model="form.category"
            required
            :disabled="state.isSubmitting"
            :aria-invalid="!!fieldErrors.category || undefined"
            :aria-describedby="fieldErrors.category ? `report-category-error-${dialogId}` : undefined"
            @change="fieldErrors.category = ''"
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
          <span
            v-if="fieldErrors.category"
            :id="`report-category-error-${dialogId}`"
            class="report-dialog__field-error"
            role="alert"
          >{{ fieldErrors.category }}</span>
        </div>

        <div class="report-dialog__field">
          <label :for="`report-description-${dialogId}`">
            {{ t('description_label') }} <span aria-hidden="true">*</span>
          </label>
          <textarea
            :id="`report-description-${dialogId}`"
            v-model="form.description"
            :placeholder="t('description_placeholder')"
            :maxlength="MAX_DESCRIPTION_LENGTH"
            rows="4"
            required
            :disabled="state.isSubmitting"
            :aria-invalid="!!fieldErrors.description || undefined"
            :aria-describedby="fieldErrors.description
              ? `report-description-error-${dialogId} report-description-counter-${dialogId}`
              : `report-description-counter-${dialogId}`"
            @input="fieldErrors.description = ''"
          />
          <span
            v-if="fieldErrors.description"
            :id="`report-description-error-${dialogId}`"
            class="report-dialog__field-error"
            role="alert"
          >{{ fieldErrors.description }}</span>
          <p
            :id="`report-description-counter-${dialogId}`"
            class="report-dialog__char-counter"
            :class="{ 'report-dialog__char-counter--warning': descriptionCharsRemaining <= 100 }"
            aria-live="polite"
          >{{ t('description_char_count', { remaining: descriptionCharsRemaining, max: MAX_DESCRIPTION_LENGTH }) }}</p>
        </div>

        <div class="report-dialog__field">
          <label :for="`report-email-${dialogId}`">
            {{ t('email_label') }} <span aria-hidden="true">*</span>
          </label>
          <input
            :id="`report-email-${dialogId}`"
            v-model="form.email"
            type="email"
            :placeholder="t('email_placeholder')"
            required
            autocomplete="email"
            :disabled="state.isSubmitting"
            :aria-invalid="!!fieldErrors.email || undefined"
            :aria-describedby="fieldErrors.email ? `report-email-error-${dialogId}` : undefined"
            @input="fieldErrors.email = ''"
          />
          <span
            v-if="fieldErrors.email"
            :id="`report-email-error-${dialogId}`"
            class="report-dialog__field-error"
            role="alert"
          >{{ fieldErrors.email }}</span>
          <p class="report-dialog__help">{{ t('email_help') }}</p>
        </div>

        <footer class="report-dialog__actions">
          <button
            type="button"
            class="report-dialog__btn report-dialog__btn--ghost"
            :disabled="state.isSubmitting"
            :aria-disabled="state.isSubmitting || undefined"
            @click="close"
          >{{ t('cancel_button') }}</button>
          <button
            type="submit"
            class="report-dialog__btn report-dialog__btn--primary"
            :disabled="state.isSubmitting"
            :aria-disabled="state.isSubmitting || undefined"
          >{{ state.isSubmitting ? t('submitting_button') : t('submit_button') }}</button>
        </footer>
      </form>
    </div>
  </dialog>
</template>

<style scoped lang="scss">
@use '../assets/mixins' as *;

// ================================================================
// REPORT EVENT DIALOG (Site / Anonymous)
// ================================================================
// A modal dialog for anonymous visitors to report an event.
// Uses the native <dialog> element for built-in accessibility.
// Uses the public site mixin-based design system for theming.
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

  &::backdrop {
    background-color: rgb(0 0 0 / 50%);
    backdrop-filter: blur(4px);
  }
}

.report-dialog__content {
  margin-block-start: 10vh;
  margin-inline: auto;
  padding: $public-space-xl;
  width: 100%;
  max-width: 480px;
  background: $public-bg-primary-light;
  border-radius: $public-radius-md;
  box-shadow: $public-shadow-xl-light;

  @include public-dark-mode {
    background: $public-bg-primary-dark;
    box-shadow: $public-shadow-xl-dark;
  }

  @include public-mobile-only {
    margin: $public-space-lg;
    max-width: calc(100% - #{$public-space-lg} * 2);
  }
}

.report-dialog__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-block-end: $public-space-xl;
  padding-block-end: $public-space-md;
  border-block-end: 1px solid $public-border-subtle-light;

  @include public-dark-mode {
    border-block-end-color: $public-border-subtle-dark;
  }

  h2 {
    margin: 0;
    font-size: $public-font-size-lg;
    font-weight: $public-font-weight-semibold;
    color: $public-text-primary-light;

    @include public-dark-mode {
      color: $public-text-primary-dark;
    }
  }
}

.report-dialog__close {
  background: none;
  border: none;
  font-size: $public-font-size-xl;
  line-height: 1;
  color: $public-text-secondary-light;
  cursor: pointer;
  padding: $public-space-xs;
  min-width: 44px;
  min-height: 44px;
  transition: $public-transition-fast;

  &:hover {
    color: $public-text-primary-light;
  }

  &:focus-visible {
    @include public-focus-visible;
  }

  @include public-dark-mode {
    color: $public-text-secondary-dark;

    &:hover {
      color: $public-text-primary-dark;
    }
  }
}

.report-dialog__error {
  @include public-error-state;

  margin-block-end: $public-space-lg;
}

.report-dialog__success {
  text-align: center;
  padding-block: $public-space-xl;

  p {
    font-size: $public-font-size-md;
    color: $public-success-light;
    margin: 0 0 $public-space-xl 0;
    line-height: $public-line-height-relaxed;

    @include public-dark-mode {
      color: $public-success-dark;
    }
  }
}

.report-dialog__field {
  margin-block-end: $public-space-lg;

  label {
    display: block;
    font-size: $public-font-size-sm;
    font-weight: $public-font-weight-medium;
    color: $public-text-primary-light;
    margin-block-end: $public-space-xs;

    span {
      color: $public-error-light;

      @include public-dark-mode {
        color: $public-error-dark;
      }
    }

    @include public-dark-mode {
      color: $public-text-primary-dark;
    }
  }

  select,
  textarea,
  input[type="email"] {
    @include public-input-base;

    box-sizing: border-box;

    &[aria-invalid="true"] {
      border-color: $public-error-light;
      outline-color: $public-error-light;

      &:focus {
        outline-color: $public-error-light;
        border-color: transparent;
      }

      @include public-dark-mode {
        border-color: $public-error-dark;
        outline-color: $public-error-dark;

        &:focus {
          outline-color: $public-error-dark;
        }
      }
    }
  }

  select {
    appearance: auto;
    cursor: pointer;
  }

  textarea {
    resize: vertical;
    min-height: 80px;
  }
}

.report-dialog__field-error {
  display: block;
  margin-block-start: $public-space-xs;
  font-size: $public-font-size-xs;
  color: $public-error-light;

  @include public-dark-mode {
    color: $public-error-dark;
  }
}

.report-dialog__help {
  margin: $public-space-xs 0 0 0;
  font-size: $public-font-size-xs;
  color: $public-text-tertiary-light;

  @include public-dark-mode {
    color: $public-text-tertiary-dark;
  }
}

.report-dialog__char-counter {
  margin: $public-space-xs 0 0 0;
  font-size: $public-font-size-xs;
  color: $public-text-tertiary-light;
  text-align: end;

  @include public-dark-mode {
    color: $public-text-tertiary-dark;
  }
}

.report-dialog__char-counter--warning {
  color: $public-error-light;

  @include public-dark-mode {
    color: $public-error-dark;
  }
}

.report-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: $public-space-md;
  margin-block-start: $public-space-xl;
  padding-block-start: $public-space-lg;
  border-block-start: 1px solid $public-border-subtle-light;

  @include public-dark-mode {
    border-block-start-color: $public-border-subtle-dark;
  }
}

.report-dialog__btn {
  @include public-button-base;

  padding: $public-space-sm $public-space-xl;
  font-size: $public-font-size-base;
}

.report-dialog__btn--primary {
  @include public-button-primary;

  padding: $public-space-sm $public-space-xl;
  font-size: $public-font-size-base;
}

.report-dialog__btn--ghost {
  @include public-button-ghost;

  padding: $public-space-sm $public-space-xl;
  font-size: $public-font-size-base;
}

// Prevent background scroll when modal is open
:global(body.modal-open) {
  overflow: hidden;
}
</style>
