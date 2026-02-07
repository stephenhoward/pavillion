<template>
  <Modal :title="t('title')" modal-class="invite-modal" @close="$emit('close')">
    <div class="invite-form">
      <div class="form-group">
        <label for="invite-email" class="form-label">{{ t('email_label') }}</label>
        <input
          id="invite-email"
          v-model="state.email"
          type="email"
          class="form-input"
          :placeholder="t('email_placeholder')"
          @keyup.enter="sendInvitation"
        />
        <p class="form-help">{{ t('email_help') }}</p>
      </div>

      <div v-if="state.errorMessage" class="message message-error" role="alert">
        {{ state.errorMessage }}
      </div>

      <div class="form-actions">
        <button type="button" class="btn-cancel" @click="$emit('close')">
          {{ t('close_button') }}
        </button>
        <button
          type="button"
          class="btn-submit"
          :disabled="!state.email.trim() || state.sending"
          @click="sendInvitation"
        >
          {{ state.sending ? '...' : t('invite_button') }}
        </button>
      </div>
    </div>
  </Modal>
</template>

<script setup>
import { reactive } from 'vue';
import { useTranslation } from 'i18next-vue';
import axios from 'axios';
import Modal from '@/client/components/common/modal.vue';

const emit = defineEmits(['close', 'invited']);
const { t } = useTranslation('admin', {
  keyPrefix: 'invite_form',
});

const state = reactive({
  email: '',
  sending: false,
  errorMessage: null,
});

const sendInvitation = async () => {
  if (!state.email.trim() || state.sending) return;
  state.sending = true;
  state.errorMessage = null;

  try {
    await axios.post('/api/v1/admin/invitations', {
      email: state.email.trim(),
    });
    emit('invited');
  }
  catch (error) {
    console.error('Error sending invitation:', error);
    state.errorMessage = error.response?.data?.error || error.message || 'Failed to send invitation';
  }
  finally {
    state.sending = false;
  }
};
</script>

<style scoped lang="scss">
.invite-form {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);

  .form-group {
    .form-label {
      display: block;
      font-size: var(--pav-font-size-xs);
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-color-text-secondary);
      margin-bottom: var(--pav-space-2);
    }

    .form-input {
      width: 100%;
      padding: var(--pav-space-2_5) var(--pav-space-5);
      background: var(--pav-color-surface-primary);
      border: 1px solid var(--pav-border-color-medium);
      border-radius: var(--pav-border-radius-full);
      color: var(--pav-color-text-primary);
      font-size: var(--pav-font-size-sm);
      font-family: inherit;
      box-sizing: border-box;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;

      &::placeholder {
        color: var(--pav-color-stone-400);
      }

      &:focus {
        outline: none;
        border-color: var(--pav-color-orange-500);
        box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.2);
      }
    }

    .form-help {
      margin: var(--pav-space-2) 0 0 0;
      font-size: var(--pav-font-size-2xs);
      color: var(--pav-color-text-muted);
    }
  }

  .message {
    padding: var(--pav-space-3) var(--pav-space-4);
    border-radius: var(--pav-border-radius-md);
    font-size: var(--pav-font-size-xs);

    &.message-error {
      background: var(--pav-color-red-50);
      border: 1px solid var(--pav-color-red-200);
      color: var(--pav-color-red-700);
    }
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--pav-space-3);
    padding-top: var(--pav-space-4);
    border-top: 1px solid var(--pav-border-color-light);

    .btn-cancel {
      padding: var(--pav-space-2) var(--pav-space-5);
      background: none;
      border: 1px solid var(--pav-border-color-medium);
      border-radius: var(--pav-border-radius-full);
      color: var(--pav-color-text-secondary);
      font-weight: var(--pav-font-weight-medium);
      font-size: var(--pav-font-size-xs);
      font-family: inherit;
      cursor: pointer;
      transition: background-color 0.2s ease;

      &:hover {
        background: var(--pav-color-stone-50);
      }
    }

    .btn-submit {
      padding: var(--pav-space-2) var(--pav-space-6);
      background: var(--pav-color-brand-primary);
      border: none;
      border-radius: var(--pav-border-radius-full);
      color: var(--pav-color-text-inverse);
      font-weight: var(--pav-font-weight-medium);
      font-size: var(--pav-font-size-xs);
      font-family: inherit;
      cursor: pointer;
      transition: background-color 0.2s ease;

      &:hover:not(:disabled) {
        background: var(--pav-color-brand-primary-dark);
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }
  }
}

@media (prefers-color-scheme: dark) {
  .invite-form {
    .form-group {
      .form-input {
        &:focus {
          box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.3);
        }
      }
    }

    .message {
      &.message-error {
        background: rgba(239, 68, 68, 0.1);
        border-color: rgba(239, 68, 68, 0.3);
        color: var(--pav-color-red-300);
      }
    }

    .form-actions {
      .btn-cancel {
        &:hover {
          background: var(--pav-color-stone-800);
        }
      }
    }
  }
}
</style>
