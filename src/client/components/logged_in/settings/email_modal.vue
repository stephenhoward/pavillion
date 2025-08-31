<style lang="scss" scoped>
dialog {
  fieldset > div {
    margin-bottom: var(--pav-space-md);

    input {
      background: var(--pav-color-surface-primary);
      border: 1px solid var(--pav-border-color-medium);
      border-radius: var(--pav-border-radius-md);
      padding: var(--pav-space-sm);
    }
  }
  small {
    display: block;
    margin-top: var(--pav-space-xs);
  }
}
</style>

<template>
  <ModalLayout :title="t('title')" modalClass="change-email-form" @close="$emit('close', state.email)">
    <form @submit.prevent="changeEmail">
      <fieldset>
        <div v-if="state.err" role="alert" aria-live="polite">
          {{ state.err }}
        </div>

        <div>
          <label for="new-email" class="sr-only">{{ t('email_placeholder') }}</label>
          <input type="email"
                 id="new-email"
                 name="email"
                 :placeholder="t('email_placeholder')"
                 v-model="state.email"
                 required
                 aria-describedby="email-help"/>
          <small id="email-help">{{ t('email_help_text') }}</small>
        </div>

        <div>
          <label for="current-password" class="sr-only">{{ t('password_placeholder') }}</label>
          <input type="password"
                 id="current-password"
                 name="password"
                 :placeholder="t('password_placeholder')"
                 v-model="state.password"
                 required
                 aria-describedby="password-help"/>
          <small id="password-help">{{ t('password_help_text') }}</small>
        </div>
      </fieldset>

      <footer>
        <button class="primary" :disabled="!state.email || !state.password" type="submit">{{ t("change_email_button") }}</button>
        <button type="button" data-variant="ghost" @click="$emit('close', state.email)">{{ t("close_button") }}</button>
      </footer>
    </form>
  </ModalLayout>
</template>

<script setup>
import { reactive, inject } from 'vue';
import { useTranslation } from 'i18next-vue';
import ModalLayout from '@/client/components/common/modal.vue';

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
