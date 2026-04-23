<template>
  <form
    class="add-import-source-form"
    novalidate
    @submit.prevent="onSubmit"
  >
    <fieldset :disabled="isSubmitting" class="add-import-source-form__fieldset">
      <legend class="add-import-source-form__legend">
        {{ t('add_fieldset_legend') }}
      </legend>

      <div v-if="errorMessage" class="alert alert--error" role="alert">
        {{ errorMessage }}
      </div>

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
          :aria-describedby="inputDescribedBy"
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
          :disabled="isSubmitting || !url.trim()"
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

const props = defineProps<{
  isSubmitting?: boolean;
  errorMessage?: string | null;
  autofocus?: boolean;
}>();

const emit = defineEmits<{
  (event: 'submit', url: string): void;
  (event: 'cancel'): void;
}>();

const { t } = useTranslation('calendars', { keyPrefix: 'import' });

const url = ref('');
const validationError = ref<string | null>(null);
const urlInputRef = ref<HTMLInputElement | null>(null);

// Unique ids so multiple instances of the form don't collide
const uid = Math.random().toString(36).slice(2, 10);
const urlInputId = computed(() => `import-source-url-${uid}`);
const urlHelpId = computed(() => `import-source-url-help-${uid}`);
const validationErrorId = computed(() => `import-source-url-error-${uid}`);

// Wire the error paragraph's id into aria-describedby when a validation error
// is present, alongside the persistent help-text id. Screen readers will then
// announce both the help text and the error when the input is focused.
const inputDescribedBy = computed(() =>
  [urlHelpId.value, validationError.value ? validationErrorId.value : null]
    .filter(Boolean)
    .join(' '),
);

const onSubmit = () => {
  validationError.value = null;
  const trimmed = url.value.trim();
  if (!trimmed) {
    validationError.value = t('url_required');
    return;
  }
  emit('submit', trimmed);
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

defineExpose({
  reset() {
    url.value = '';
    validationError.value = null;
  },
  focus() {
    urlInputRef.value?.focus();
  },
});
</script>

<style scoped lang="scss">
@use '../../../../assets/style/components/calendar-admin' as *;

.add-import-source-form {
  &__fieldset {
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-4);
  }

  &__legend {
    font-size: 1rem;
    font-weight: 500;
    color: var(--pav-color-stone-900);
    padding: 0;
    margin-bottom: var(--pav-space-2);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
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

.btn-ghost {
  padding: var(--pav-space-2) var(--pav-space-4);
  background: none;
  border: none;
  color: var(--pav-color-stone-600);
  font-weight: 500;
  cursor: pointer;
  transition: color 0.2s;
  border-radius: 0.375rem;

  &:hover {
    color: var(--pav-color-stone-900);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
</style>
