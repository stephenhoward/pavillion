<style lang="scss">
@use '../../assets/mixins' as *;

div.change-password-form {
  max-width: 400px;
  button {
    display: inline-block;
    margin-right: 10px;
  }
}
</style>

<template>
  <ModalLayout :title="t('title')" @close="$emit('close')" modalClass="change-password-form">
    <div class="invite">
      <div class="error" v-if="state.err">{{ state.err }}</div>
      <div v-if="state.linkSent" class="success">{{ t('link_sent_message', { email: state.email }) }}</div>
      <div v-else >
        <p>{{ t('send_link_description', { email: state.email }) }}</p>
        <button type="submit" class="primary" @click="sendPasswordReset()">{{ t("send_password_link_button") }}</button>
      </div>
      <button type="button" @click="$emit('close')">{{ state.linkSent ? t("close_button") : t("cancel_button") }}</button>
    </div>
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
