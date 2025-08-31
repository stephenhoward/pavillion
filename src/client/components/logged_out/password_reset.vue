<template>
  <form v-if="! state.codeValidated"
        class="welcome-card"
        @submit.prevent="submitResetCode"
        novalidate>
    <h3>{{ t('check_email_title') }}</h3>
    <p>{{ t('check_email') }} {{ state.email }}.</p>
    <fieldset class="form-stack">
      <label for="reset-code" class="sr-only">{{ t('reset_code') }}</label>
      <input type="text"
             id="reset-code"
             class="form-control"
             :class="{ 'form-control--error': state.form_error }"
             v-model="state.reset_code"
             :placeholder="t('reset_code')"
             :aria-invalid="state.form_error ? 'true' : 'false'"
             :aria-describedby="state.form_error ? 'reset-code-error' : undefined"
             required />
      <button class="primary"
              type="submit"
              :aria-describedby="state.form_error ? 'reset-code-error' : undefined">
        {{ t('reset_button') }}
      </button>
    </fieldset>
    <router-link :to="{ name: 'login', params: { em: state.email }}" >{{ t("login_link") }}</router-link>
    <div v-if="state.form_error"
         class="alert alert--error alert--sm"
         role="alert"
         aria-live="polite">
      <span id="reset-code-error">{{ t(state.form_error) }}</span>
    </div>
  </form>
  <form v-else
        class="welcome-card"
        @submit.prevent="setPassword"
        novalidate>
    <h3>{{ state.isRegistration ? t('new_account_password_title') : t('code_validated_title') }}</h3>
    <p>{{ state.isRegistration ? t('registration_new_password') : t('set_password_prompt') }}</p>
    <fieldset class="form-stack">
      <legend class="sr-only">{{ state.isRegistration ? t('new_account_password_title') : t('code_validated_title') }}</legend>
      <label for="new-password" class="sr-only">{{ t('password_placeholder') }}</label>
      <input type="password"
             id="new-password"
             class="form-control"
             :class="{ 'form-control--error': state.form_error }"
             :placeholder="t('password_placeholder')"
             v-model="state.password"
             :aria-invalid="state.form_error ? 'true' : 'false'"
             :aria-describedby="state.form_error ? 'password-error' : undefined"
             required/>
      <label for="confirm-password" class="sr-only">{{ t('password2_placeholder') }}</label>
      <input type="password"
             id="confirm-password"
             class="form-control"
             :class="{ 'form-control--error': state.form_error }"
             :placeholder="t('password2_placeholder')"
             v-model="state.password2"
             :aria-invalid="state.form_error ? 'true' : 'false'"
             :aria-describedby="state.form_error ? 'password-error' : undefined"
             @keyup.enter="setPassword"
             required/>
      <button type="submit"
              class="primary"
              :aria-describedby="state.form_error ? 'password-error' : undefined">
        <span class="icofont-arrow-right"/>
        <span class="sr-only">{{ t("next") }}</span>
      </button>
    </fieldset>
    <div v-if="state.form_error"
         class="alert alert--error alert--sm"
         role="alert"
         aria-live="polite">
      <span id="password-error">{{ t(state.form_error) }}</span>
    </div>
  </form>
</template>

<style lang="scss">
</style>

<script setup>
import { reactive, onBeforeMount, inject } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';

const router = useRouter();
const route = useRoute();
const { t } = useTranslation('authentication', {
  keyPrefix: 'reset_password',
});
const authn = inject('authn');

const state = reactive({
  reset_code: route.query.code || '',
  email: route.query.email || '',
  codeValidated: false,
  password:    '',
  password2:   '',
  form_error: '',
});

onBeforeMount(async () => {
  if ( state.reset_code ) {
    console.log("checking password reset token");
    await submitResetCode();
  }
});

async function submitResetCode() {

  state.form_error = '';
  const valid = await authn.check_password_reset_token(state.reset_code);
  state.codeValidated = valid;
  if ( valid ) {
    state.isRegistration = response.isNewAccount;
  }
  else {
    state.form_error = 'bad_token';
  }
}

async function setPassword() {
  if ( ! state.password.length ) {
    state.form_error = 'missing_password';
  }
  else if ( ! state.password2.length ) {
    state.form_error = 'missing_password2';
  }
  else if ( state.password != state.password2 ) {
    state.form_error = 'bad_password_match';
  }
  else {
    state.form_error = '';
    try {
      await authn.use_password_reset_token(state.reset_code, state.password);
      router.push('/auth/login');
    }
    catch (error) {
      let error_text = "unknown_error";

      if ( typeof error  == "object" && "response" in error ) {
        error_text = error.response.data || error.response.status;
      }
      else if ( typeof error == "string" ) {
        error_text = error;
      }
      else {
        console.log(error);
      }

      state.form_error = t( error_text ) || error_text;
    }
  }
}

</script>

