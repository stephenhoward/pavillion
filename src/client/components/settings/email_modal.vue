<style lang="scss">
@use '../../assets/mixins' as *;

dialog.modal-dialog.change-email-form .modal-content {
  max-width: 400px;
  form {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-gap: 10px;
    margin: 0 auto;
    input[type="text"],input[type="password"] {
      font-size: 14pt;
      background-color: rgba(255,255,255,0.5);
      margin: 6px 0px;
      grid-column: 1 / span 2;
      border: 1px solid #ccc;
      border-radius: $form-input-border-radius;
      padding: 8px 18px;
      display: block;
      &:focus {
        border: 1px solid rgb(73, 111, 186);
      }
      @include dark-mode {
        background-color: rgba(100,100,100,0.2);
        border: 1px solid #777;
        color: $dark-mode-text;
        &:focus {
          border: 1px solid #abd;
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
      grid-column-start: 1;
      grid-column-end: 3;
    }
  }
}


</style>

<template>
  <ModalLayout :title="t('title')" modalClass="change-email-form" @close="$emit('close', state.email)">
    <form class="change-email-form">
      <div class="error" v-if="state.err">{{ state.err }}</div>
      <input type="text"
             name="email"
             v-bind:placeholder="t('email_placeholder')"
             v-model="state.email"/>
      <input type="password"
             name="password"
             v-bind:placeholder="t('password_placeholder')"
             v-model="state.password"/>
      <footer>
        <button type="submit" class="primary" @click="changeEmail()">{{ t("change_email_button") }}</button>
        <button type="button" @click="$emit('close', state.email)">{{ t("close_button") }}</button>
      </footer>
    </form>
  </ModalLayout>
</template>

<script setup>
import { reactive, inject } from 'vue';
import { useTranslation } from 'i18next-vue';
import ModalLayout from '../modal.vue';

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

const changeEmail = async () => {
  const ok = await authn.changeEmail( state.email, state.password );
  if ( ok ) {
    emit('close', state.email);
  }
  else {
    state.err = t('change_email_failed_message');
  }
};
</script>
