<style lang="scss">
/* Password modal semantic styling using design tokens */
dialog.modal-dialog.change-password-form {
  > div {
    max-width: 400px;
}
  p {
    margin-bottom: var(--pav-space-md);
  }
  button {
    margin-right: var(--pav-space-md);
  }
}
</style>

<template>
  <ModalLayout :title="t('title')" @close="$emit('close')" modalClass="change-password-form">
    <div v-if="state.linkSent" role="status" aria-live="polite">
      {{ t('link_sent_message', { email: state.email }) }}
    </div>
    <form v-else>
      <fieldset>
        <div v-if="state.err" role="alert" aria-live="polite">
          {{ state.err }}
        </div>
        <div>
          <p>{{ t('send_link_description', { email: state.email }) }}</p>
          <button type="button" class="primary" @click="sendPasswordReset()">
            {{ t("send_password_link_button") }}
          </button>
          <button type="button" data-variant="ghost" @click="$emit('close')">
            {{ state.linkSent ? t("close_button") : t("cancel_button") }}
          </button>
        </div>
      </fieldset>

      <footer v-if="state.linkSent">
        <button type="button" data-variant="ghost" @click="$emit('close')">
          {{ state.linkSent ? t("close_button") : t("cancel_button") }}
        </button>
      </footer>
    </form>
  </ModalLayout>
</template>

<script setup>
import { inject, reactive } from 'vue';
import { useTranslation } from 'i18next-vue';
import ModalLayout from '@/client/components/common/modal.vue';

const emit = defineEmits(['close']);
const authn = inject('authn');

const { t } = useTranslation('profile', {
  keyPrefix: 'change_password_form',
});

const state = reactive({
  email: authn.userEmail(),
  password: '',
  err: '',
  linkSent: false,
});

const sendPasswordReset = async () => {
  const ok = await authn.reset_password(state.email);
  if ( ok ) {
    state.linkSent = true;
    state.err = '';
  }
  else {
    state.err = t('change_email_failed_message');
  }
};
</script>
