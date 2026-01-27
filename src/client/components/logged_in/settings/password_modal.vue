<script setup>
import { inject, reactive, ref, onMounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import Modal from '@/client/components/common/modal.vue';

const emit = defineEmits(['close']);
const authn = inject('authn');

const { t } = useTranslation('profile', {
  keyPrefix: 'change_password_form',
});

const state = reactive({
  email: authn.userEmail(),
  err: '',
  linkSent: false,
});

const buttonRef = ref(null);

onMounted(() => {
  // Focus button when modal opens
  setTimeout(() => {
    if (buttonRef.value) {
      buttonRef.value.focus();
    }
  }, 100);
});

const sendPasswordReset = async () => {
  const ok = await authn.reset_password(state.email);
  if (ok) {
    state.linkSent = true;
    state.err = '';
    emit('close');
  }
  else {
    state.err = t('reset_failed_message', { defaultValue: 'Failed to send password reset email. Please try again.' });
  }
};
</script>

<template>
  <Modal
    :title="t('title', { defaultValue: 'Change Password' })"
    @close="$emit('close')"
    modal-class="change-password-modal"
  >
    <div class="modal-content-inner">
      <div v-if="state.err"
           class="error-message"
           role="alert"
           aria-live="polite">
        {{ state.err }}
      </div>

      <div class="info-box">
        <div class="info-icon">
          <svg class="icon-mail"
               fill="none"
               viewBox="0 0 24 24"
               stroke="currentColor">
            <path stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <div class="info-text">
          <p class="info-title">
            {{ t('reset_via_email_title', { defaultValue: 'Password reset via email' }) }}
          </p>
          <p class="info-description">
            {{ t('send_link_description', {
              defaultValue: `Send a link to ${state.email} to reset my password`,
              email: state.email
            }) }}
          </p>
        </div>
      </div>

      <!-- Footer -->
      <div class="modal-footer">
        <button
          type="button"
          class="btn-cancel"
          @click="$emit('close')"
        >
          {{ t('cancel_button', { defaultValue: 'Cancel' }) }}
        </button>
        <button
          ref="buttonRef"
          type="button"
          class="btn-submit"
          @click="sendPasswordReset"
        >
          {{ t('send_password_link_button', { defaultValue: 'Send Password Link' }) }}
        </button>
      </div>
    </div>
  </Modal>
</template>

<style lang="scss">
/* Override shared modal width for settings modals - must be unscoped to work */
.change-password-modal > div {
  max-width: 28rem !important; // 448px - override the 90vw default
}
</style>

<style scoped lang="scss">
.modal-content-inner {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-5);
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

.info-box {
  display: flex;
  align-items: flex-start;
  gap: var(--pav-space-4);
  padding: var(--pav-space-4);
  background: rgba(14, 165, 233, 0.1);
  border: 1px solid rgba(14, 165, 233, 0.2);
  border-radius: 0.75rem;

  @media (prefers-color-scheme: dark) {
    background: rgba(7, 89, 133, 0.3);
    border-color: rgba(7, 89, 133, 0.8);
  }
}

.info-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  background: rgba(14, 165, 233, 0.1);
  border-radius: 0.5rem;

  @media (prefers-color-scheme: dark) {
    background: rgba(3, 105, 161, 0.9);
  }

  .icon-mail {
    width: 1.25rem;
    height: 1.25rem;
    color: rgb(14, 116, 144);

    @media (prefers-color-scheme: dark) {
      color: rgb(125, 211, 252);
    }
  }
}

.info-text {
  flex: 1;
}

.info-title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 500;
  color: rgb(12, 74, 110);

  @media (prefers-color-scheme: dark) {
    color: rgb(224, 242, 254);
  }
}

.info-description {
  margin: var(--pav-space-1) 0 0 0;
  font-size: 0.875rem;
  color: rgb(14, 116, 144);

  @media (prefers-color-scheme: dark) {
    color: rgb(186, 230, 253);
  }
}

.modal-footer {
  display: flex;
  gap: var(--pav-space-3);
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

  &:hover {
    background: var(--pav-color-orange-600);
  }
}
</style>
