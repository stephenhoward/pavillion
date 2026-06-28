<script setup>
import { reactive, inject, ref, onMounted, computed, nextTick } from 'vue';
import { useTranslation } from 'i18next-vue';
import Modal from '@/client/components/common/modal.vue';

const emit = defineEmits(['close']);
const authn = inject('authn');

const { t } = useTranslation('profile', {
  keyPrefix: 'change_email_form',
});

const state = reactive({
  email: '',
  password: '',
  err: '',
  sent: false,
});

const firstInputRef = ref(null);
const doneButtonRef = ref(null);

onMounted(() => {
  // Focus first input when modal opens
  setTimeout(() => {
    if (firstInputRef.value) {
      firstInputRef.value.focus();
    }
  }, 100);
});

const changeEmail = async () => {
  const ok = await authn.changeEmail(state.email, state.password);
  if (ok) {
    // The address is NOT changed yet — a confirmation link was sent to the new
    // inbox. Show the confirmation prompt rather than reporting an immediate
    // change, and close without signalling a new address to the parent.
    state.err = '';
    state.sent = true;
    // The previously-focused submit button is now removed from the DOM. Move
    // focus to the Done button so keyboard/AT users aren't dropped to <body>.
    await nextTick();
    doneButtonRef.value?.focus();
  }
  else {
    state.err = t('change_email_failed_message');
  }
};

const isValid = computed(() => state.email.length > 0 && state.email.includes('@') && state.password.length > 0);
</script>

<template>
  <Modal
    :title="t('title', { defaultValue: 'Change Email Address' })"
    @close="$emit('close', null)"
    modal-class="change-email-modal"
  >
    <div v-if="state.sent" class="modal-form">
      <p class="confirm-sent-text"
         role="status"
         aria-live="polite">
        {{ t('confirm_sent_message', { defaultValue: 'Check your new inbox to confirm the change. Your email address will only update once you click the link we just sent.' }) }}
      </p>
      <div class="modal-footer">
        <button
          ref="doneButtonRef"
          type="button"
          class="btn-submit"
          @click="$emit('close', null)"
        >
          {{ t('done_button', { defaultValue: 'Done' }) }}
        </button>
      </div>
    </div>

    <form v-else @submit.prevent="changeEmail" class="modal-form">
      <p class="current-email-text">
        {{ t('current_email_label', { defaultValue: 'Current email:' }) }}
        <span class="current-email-value">{{ authn.userEmail() }}</span>
      </p>

      <div v-if="state.err"
           class="error-message"
           role="alert"
           aria-live="polite">
        {{ state.err }}
      </div>

      <div class="form-group">
        <label for="new-email" class="form-label">
          {{ t('email_placeholder', { defaultValue: 'New Email Address' }) }}
        </label>
        <input
          ref="firstInputRef"
          id="new-email"
          type="email"
          v-model="state.email"
          :placeholder="t('email_field_placeholder', { defaultValue: 'Enter your new email' })"
          class="form-input"
          required
        />
      </div>

      <div class="form-group">
        <label for="confirm-password" class="form-label">
          {{ t('password_placeholder', { defaultValue: 'Confirm with Password' }) }}
        </label>
        <input
          id="confirm-password"
          type="password"
          v-model="state.password"
          :placeholder="t('password_field_placeholder', { defaultValue: 'Enter your current password' })"
          class="form-input"
          required
        />
        <p class="help-text">
          {{ t('password_help_text', { defaultValue: 'For security, please confirm this change with your password' }) }}
        </p>
      </div>

      <!-- Footer -->
      <div class="modal-footer">
        <button
          type="button"
          class="btn btn--ghost btn--pill"
          @click="$emit('close', null)"
        >
          {{ t('close_button', { defaultValue: 'Cancel' }) }}
        </button>
        <button
          type="submit"
          class="btn-submit"
          :disabled="!isValid"
        >
          {{ t('change_email_button', { defaultValue: 'Change Email' }) }}
        </button>
      </div>
    </form>
  </Modal>
</template>

<style lang="scss">
/* Override shared modal width for settings modals - must be unscoped to work */
.change-email-modal > div {
  max-width: 28rem !important; // 448px - override the 90vw default
}
</style>

<style scoped lang="scss">
.modal-form {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-5);
}

.current-email-text {
  margin: 0;
  font-size: 0.875rem;
  color: var(--pav-text-muted);

  .current-email-value {
    font-weight: 500;
    color: var(--pav-text-secondary);
  }
}

.confirm-sent-text {
  margin: 0;
  font-size: 0.875rem;
  color: var(--pav-text-secondary);
}

.error-message {
  padding: var(--pav-space-3);
  background: var(--pav-color-alert-error-bg);
  border: 1px solid var(--pav-color-error);
  border-radius: 0.5rem;
  color: var(--pav-color-alert-error-text);
  font-size: 0.875rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-2);
}

.form-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--pav-text-secondary);
}

.form-input {
  width: 100%;
  padding: 0.75rem 1rem;
  background: var(--pav-surface-secondary);
  border: 1px solid var(--pav-border-subtle);
  border-radius: 9999px;
  color: var(--pav-text-primary);
  font-size: 1rem;
  transition: box-shadow 0.2s, border-color 0.2s;

  &::placeholder {
    color: var(--pav-text-muted);
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px var(--pav-color-orange-500);
    border-color: transparent;
  }
}

.help-text {
  margin: 0;
  font-size: 0.75rem;
  color: var(--pav-text-muted);
}

.modal-footer {
  display: flex;
  gap: var(--pav-space-3);
  padding-top: var(--pav-space-2);
}

/* Both footer buttons stretch to split the row evenly. The Cancel button is now
   the design-system .btn ghost pill; .btn-submit keeps its own flex below. */
.modal-footer .btn {
  flex: 1;
}

.btn-submit {
  flex: 1;
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: white;
  background: var(--pav-color-orange-500);
  border: none;
  border-radius: 9999px;
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover:not(:disabled) {
    background: var(--pav-color-orange-600);
  }

  &:focus-visible {
    outline: var(--pav-border-width-2) solid var(--pav-border-color-focus);
    outline-offset: var(--pav-space-0_5);
    box-shadow: var(--pav-shadow-focus);
  }

  &:disabled {
    background: var(--pav-interactive-disabled);
    cursor: not-allowed;
  }
}
</style>
