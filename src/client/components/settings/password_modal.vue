<style lang="scss">
@use '../../assets/mixins' as *;

dialog.modal-dialog.change-password-form .modal-content {
  max-width: 400px;

  form {
    display: grid;
    grid-template-columns: 1fr;
    grid-gap: 10px;
    & > div {
      text-align: center;
      p {
        text-align: start;
      }
    }
  }

  button {
    display: inline-block;
    margin-right: 10px;
  }

  footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 15px;
  }

  .success {
    margin: 10px 0;
    color: green;
  }

  .error {
    margin: 10px 0;
    color: red;
  }
}
</style>

<template>
  <ModalLayout :title="t('title')" @close="$emit('close')" modalClass="change-password-form">
    <form>
      <div class="error" v-if="state.err">{{ state.err }}</div>
      <div v-if="state.linkSent" class="success">{{ t('link_sent_message', { email: state.email }) }}</div>
      <div v-else >
        <p>{{ t('send_link_description', { email: state.email }) }}</p>
        <button type="button" class="primary" @click="sendPasswordReset()">{{ t("send_password_link_button") }}</button>
      </div>
      <footer>
        <button type="button" @click="$emit('close')">{{ state.linkSent ? t("close_button") : t("cancel_button") }}</button>
      </footer>
    </form>
  </ModalLayout>
</template>

<script setup>
import { inject, reactive } from 'vue';
import { useTranslation } from 'i18next-vue';
import ModalLayout from '../modal.vue';

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
