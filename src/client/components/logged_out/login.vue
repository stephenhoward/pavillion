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

<script setup lang="ts">
import { reactive, inject } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import ErrorAlert from './error-alert.vue';

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

    let errorKey = 'unknown_error';

    if (error && typeof error === 'object' && 'response' in error) {
      const responseError = error as any;
      if (responseError.response && responseError.response.data) {
        const data = responseError.response.data;
        if (data.errorName && typeof data.errorName === 'string') {
          errorKey = data.errorName;
        }
        else if (data.error && typeof data.error === 'string') {
          errorKey = data.error;
        }
      }
    }
    else if (typeof error === 'string') {
      errorKey = error;
    }

    state.err = t(errorKey);
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

