<script setup>
import { reactive, inject, ref, onMounted, computed } from 'vue';
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
});

const firstInputRef = ref(null);

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
    emit('close', state.email);
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
    <form @submit.prevent="changeEmail" class="modal-form">
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
          class="btn-cancel"
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
  color: var(--pav-color-stone-500);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }

  .current-email-value {
    font-weight: 500;
    color: var(--pav-color-stone-700);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-300);
    }
  }
}

.error-message {
  padding: var(--pav-space-3);
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 0.5rem;
  color: var(--pav-color-red-700);
  font-size: 0.875rem;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-red-400);
  }
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
  color: var(--pav-color-stone-700);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-300);
  }
}

.form-input {
  width: 100%;
  padding: 0.75rem 1rem;
  background: var(--pav-color-stone-50);
  border: 1px solid var(--pav-color-stone-200);
  border-radius: 9999px;
  color: var(--pav-color-stone-900);
  font-size: 1rem;
  transition: box-shadow 0.2s, border-color 0.2s;

  &::placeholder {
    color: var(--pav-color-stone-400);
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px var(--pav-color-orange-500);
    border-color: transparent;
  }

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-800);
    border-color: var(--pav-color-stone-700);
    color: var(--pav-color-stone-100);
  }
}

.help-text {
  margin: 0;
  font-size: 0.75rem;
  color: var(--pav-color-stone-500);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.modal-footer {
  display: flex;
  gap: var(--pav-space-3);
  padding-top: var(--pav-space-2);
}

.btn-cancel {
  flex: 1;
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--pav-color-stone-700);
  background: var(--pav-color-stone-100);
  border: none;
  border-radius: 9999px;
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover {
    background: var(--pav-color-stone-200);

    @media (prefers-color-scheme: dark) {
      background: var(--pav-color-stone-700);
    }
  }

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-300);
    background: var(--pav-color-stone-800);
  }
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

  &:disabled {
    background: var(--pav-color-stone-300);
    cursor: not-allowed;

    @media (prefers-color-scheme: dark) {
      background: var(--pav-color-stone-700);
    }
  }
}
</style>
