<script setup lang="ts">
import { ref, reactive, computed, inject } from 'vue';
import { useTranslation } from 'i18next-vue';
import ReportService from '@/client/service/report';
import { DuplicateReportError, ReportValidationError } from '@/common/exceptions/report';
import { EventNotFoundError } from '@/common/exceptions/calendar';
import { ReportCategory } from '@/common/model/report';
import Modal from '@/client/components/common/modal.vue';

const { t } = useTranslation('system', {
  keyPrefix: 'report',
});

const props = defineProps<{
  eventId: string;
  eventTitle?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

/** Maximum allowed length for report description text. */
const MAX_DESCRIPTION_LENGTH = 2000;

/** Unique ID for accessible label association of form fields. */
const fieldId = Math.random().toString(36).substring(2, 11);

const reportService = new ReportService();

/**
 * Ref to the Modal instance. In-slot close paths (Cancel, success dismiss)
 * route through the Modal's exposed close() so useDialog restores focus to the
 * triggering element before the @close handler runs.
 */
const modalRef = ref<InstanceType<typeof Modal> | null>(null);

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
 * Fires once for every close path (header X, Escape, backdrop, Cancel, and the
 * success dismiss button) via the Modal's @close event. By this point
 * useDialog.close() has already restored focus to the triggering element.
 * Resets the form, then re-emits close so the parent can unmount the component.
 */
function handleClose() {
  resetForm();
  emit('close');
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

defineExpose({ state });
</script>

<template>
  <Modal
    ref="modalRef"
    :title="t('form_title')"
    size="lg"
    @close="handleClose"
  >
    <p
      v-if="props.eventTitle"
      class="report-dialog__event-subtitle"
    >{{ t('event_subtitle', { title: props.eventTitle }) }}</p>

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
        @click="modalRef?.close()"
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
          :for="`report-category-${fieldId}`"
        >
          {{ t('category_label') }} <span aria-hidden="true">*</span>
        </label>
        <select
          :id="`report-category-${fieldId}`"
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
          :for="`report-description-${fieldId}`"
        >
          {{ t('description_label') }} <span aria-hidden="true">*</span>
        </label>
        <textarea
          :id="`report-description-${fieldId}`"
          v-model="form.description"
          class="textarea"
          :placeholder="t('description_placeholder')"
          :maxlength="MAX_DESCRIPTION_LENGTH"
          rows="4"
          required
          :disabled="state.isSubmitting"
          :aria-describedby="`report-description-counter-${fieldId}`"
        />
        <p
          :id="`report-description-counter-${fieldId}`"
          class="form__help report-dialog__char-counter"
          :class="{ 'report-dialog__char-counter--warning': descriptionCharsRemaining <= 100 }"
          aria-live="polite"
        >{{ t('description_char_count', { remaining: descriptionCharsRemaining, max: MAX_DESCRIPTION_LENGTH }) }}</p>
      </div>

      <!-- Email display (read-only for authenticated users) -->
      <div class="form__group">
        <label
          class="form__label"
          :for="`report-email-${fieldId}`"
        >
          {{ t('email_label') }}
        </label>
        <div
          :id="`report-email-${fieldId}`"
          class="input report-dialog__email-display"
        >{{ userEmail }}</div>
      </div>

      <footer class="report-dialog__actions">
        <button
          type="button"
          class="btn btn--secondary"
          :disabled="state.isSubmitting"
          @click="modalRef?.close()"
        >{{ t('cancel_button') }}</button>
        <button
          type="submit"
          class="btn btn--primary"
          :disabled="state.isSubmitting"
        >{{ state.isSubmitting ? t('submitting_button') : t('submit_button') }}</button>
      </footer>
    </form>
  </Modal>
</template>

<style scoped lang="scss">
// ================================================================
// REPORT EVENT DIALOG (Client / Authenticated)
// ================================================================
// Content styles for the report-event form. The modal shell (backdrop,
// header, close button, scroll lock) is owned by the shared <Modal>
// component; only component-specific layout styles remain here.
// ================================================================

.report-dialog__event-subtitle {
  margin: 0 0 var(--pav-space-lg) 0;
  font-size: var(--pav-font-size-sm);
  color: var(--pav-text-muted);
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
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
  justify-content: end;
  gap: var(--pav-space-md);
  margin-block-start: var(--pav-space-xl);
  padding-block-start: var(--pav-space-lg);
  border-block-start: var(--pav-border-width-1) solid var(--pav-border-subtle);
}

// Required asterisk color
.form__label span {
  color: var(--pav-color-error);
}
</style>
