<template>
  <div v-if="! state.codeValidated" class="welcome-card">
    <h3>{{ t('bad_invite_title') }}</h3>
    <p>{{ t('bad_invite_explanation') }}</p>
    <router-link class="primary"
                 :to="{ name: 'login', params: { em: state.email}}"
                 role="button">
      {{ t("go_login") }}
    </router-link>
  </div>
  <form v-else
        class="card card--elevated vstack stack--lg card__content"
        @submit.prevent="setPassword"
        novalidate>
    <h3>{{ t('new_account_password_title') }}</h3>
    <p>{{ t('registration_new_password') }}</p>
    <div class="alert alert--error alert--sm"
         v-if="state.form_error"
         role="alert"
         aria-live="polite"
         :aria-describedby="state.form_error ? 'invite-error' : undefined">
      <span id="invite-error">{{ t(state.form_error) }}</span>
    </div>
    <fieldset class="form-stack">
      <label for="invite-password" class="sr-only">{{ t('password_placeholder') }}</label>
      <input type="password"
             id="invite-password"
             class="form-control"
             :class="{ 'form-control--error': state.form_error }"
             :placeholder="t('password_placeholder')"
             v-model="state.password"
             :aria-invalid="state.form_error ? 'true' : 'false'"
             :aria-describedby="state.form_error ? 'invite-error' : undefined"
             required/>
      <label for="invite-password2" class="sr-only">{{ t('password2_placeholder') }}</label>
      <input type="password"
             id="invite-password2"
             class="form-control"
             :class="{ 'form-control--error': state.form_error }"
             :placeholder="t('password2_placeholder')"
             v-model="state.password2"
             :aria-invalid="state.form_error ? 'true' : 'false'"
             :aria-describedby="state.form_error ? 'invite-error' : undefined"
             @keyup.enter="setPassword"
             required/>
      <button class="primary"
              type="submit"
              :aria-describedby="state.form_error ? 'invite-error' : undefined">
        {{ t('set_password_button') || 'Set Password' }}
      </button>
    </fieldset>
  </form>
</template>



<script setup>
import { inject, onBeforeMount, reactive } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';

const router = useRouter();
const route = useRoute();
const authn = inject('authn');

const { t } = useTranslation('registration', {
  keyPrefix: 'accept_invite',
});


const state = reactive({
  form_error: '',
  invite_code: route.query.code || '',
  codeValidated: false,
  password:    '',
  password2:   '',
});

onBeforeMount(async () => {
  if ( state.invite_code ) {
    await checkInvitationCode();
  }
});
async function checkInvitationCode() {

  state.form_error = '';
  try {
    const response = await authn.check_invite_token(state.invite_code);
    if ( response.message == 'ok' ) {
      state.codeValidated = true;
    }
    else {
      state.codeValidated = false;
      state.form_error = 'bad_token';
    }
  }
  catch (error) {
    state.codeValidated = false;
    state.form_error = 'bad_token';
    console.error("Error checking invitation code:", error);
  }
}

async function setPassword() {
  if ( ! state.password.length ) {
    state.form_error = 'missing_password';
    return;
  }
  if ( ! state.password2.length ) {
    state.form_error = 'missing_password2';
    return;
  }
  if ( state.password != state.password2 ) {
    state.form_error = 'bad_password_match';
    return;
  }

  state.form_error = '';
  try {
    await authn.accept_invitation(state.invite_code, state.password);
    router.push('/auth/login');
  }
  catch (error) {

    let error_text = "unknown_error";

    if ( typeof error  == "object" && "message" in error ) {
      error_text = error.message;
    }
    else if ( typeof error == "string" ) {
      error_text = error;
    }
    else {
      console.log(error);
    }

    state.form_error = t(error_text) || error_text;
  }
}
</script>
