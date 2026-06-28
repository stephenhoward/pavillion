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
          class="btn btn--ghost btn--pill"
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
  background: var(--pav-color-alert-error-bg);
  border: 1px solid var(--pav-color-error);
  border-radius: 0.5rem;
  color: var(--pav-color-alert-error-text);
  font-size: 0.875rem;
}

.info-box {
  display: flex;
  align-items: flex-start;
  gap: var(--pav-space-4);
  padding: var(--pav-space-4);
  background: var(--pav-color-alert-info-bg);
  border: 1px solid var(--pav-color-info);
  border-radius: 0.75rem;
}

.info-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  background: var(--pav-color-alert-info-bg);
  border-radius: 0.5rem;

  .icon-mail {
    width: 1.25rem;
    height: 1.25rem;
    color: var(--pav-color-info);
  }
}

.info-text {
  flex: 1;
}

.info-title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--pav-color-alert-info-text);
}

.info-description {
  margin: var(--pav-space-1) 0 0 0;
  font-size: 0.875rem;
  color: var(--pav-color-alert-info-text);
}

.modal-footer {
  display: flex;
  gap: var(--pav-space-3);
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

  &:hover {
    background: var(--pav-color-orange-600);
  }
}
</style>
