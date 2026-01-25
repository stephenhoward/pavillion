<template>
  <form class="welcome-card"
        @submit.prevent="doLogin"
        novalidate>
    <h3>{{ t('title') }}</h3>

    <ErrorAlert :error="state.err" />

    <div class="form-stack">
      <label for="login-email" class="sr-only">{{ t('email') }}</label>
      <input type="email"
             id="login-email"
             :class="{ 'form-control--error': state.err }"
             :placeholder="t('email')"
             v-model="state.email"
             :aria-invalid="state.err ? 'true' : 'false'"
             :aria-describedby="state.err ? 'login-error' : undefined"
             autocomplete="email"
             required/>

      <label for="login-password" class="sr-only">{{ t('password') }}</label>
      <input type="password"
             id="login-password"
             :class="{ 'form-control--error': state.err }"
             :placeholder="t('password')"
             v-model="state.password"
             :aria-invalid="state.err ? 'true' : 'false'"
             :aria-describedby="state.err ? 'login-error' : undefined"
             autocomplete="current-password"
             @keyup.enter="doLogin"
             required/>

      <button class="primary"
              type="submit"
              :aria-describedby="state.err ? 'login-error' : undefined">
        {{ t("login_button") }}
      </button>
    </div>

    <div v-if="state.registrationMode == 'open' || state.registrationMode == 'apply'"
         class="secondary-actions">
      <router-link v-if="state.registrationMode == 'open'"
                   :to="{ name: 'register', query: { email: state.email}}"
                   role="button">
        {{ t("register_button") }}
      </router-link>
      <router-link v-if="state.registrationMode == 'apply'"
                   :to="{ name: 'register-apply', query: { email: state.email}}"
                   role="button">
        {{ t("apply_button") }}
      </router-link>
    </div>

    <router-link class="forgot"
                 :to="{ name: 'forgot_password', query: { email: state.email }}">
      {{ t("forgot_password") }}
    </router-link>
  </form>
</template>

<script setup>
import { reactive, inject } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import ErrorAlert from './ErrorAlert.vue';

const router = useRouter();
const route = useRoute();
const authn = inject('authn');
const site_config = inject('site_config');
const { t } = useTranslation('authentication', {
  keyPrefix: 'login',
});

const state = reactive({
  err      : '',
  email    : route.query.email || '',
  password : '',
  registrationMode : site_config.settings().registrationMode,
});

async function doLogin() {
  if ( state.email == '' || state.password == '' ) {
    state.err = t('MissingLogin');
    return;
  }
  try {

    if ( await authn.login(state.email,state.password) ) {
      state.err = '';
      router.push('/calendar');
    }
    else {
      state.err = t('400');
    }
  }
  catch(error) {

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

    state.err = t(error_text) || error_text;
  }
}
</script>

<style scoped lang="scss">
.form-stack {
  display: flex;
  flex-direction: column;
  gap: 1.5rem; /* 24px */
}

.secondary-actions {
  margin-top: 1.5rem; /* 24px */
}
</style>

