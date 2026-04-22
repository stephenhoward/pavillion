<script setup lang="ts">
import { reactive, inject, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { isValidEmail } from '@/common/validation/email';
import ErrorAlert from './error-alert.vue';

interface Props {
  initialEmail?: string;
  headingLevel?: 'h2' | 'h3';
}

const props = withDefaults(defineProps<Props>(), {
  initialEmail: '',
  headingLevel: 'h2',
});

const emit = defineEmits<{
  (e: 'success'): void;
}>();

const authn = inject('authn') as any;
const site_config = inject('site_config') as any;
const { t } = useTranslation('authentication', {
  keyPrefix: 'login',
});

const state = reactive({
  err      : '',
  email    : props.initialEmail,
  password : '',
});

const registrationMode = computed(() => site_config.settings().registrationMode);

async function doLogin() {
  if ( state.email == '' || state.password == '' ) {
    state.err = t('MissingLogin');
    return;
  }
  if ( !isValidEmail(state.email) ) {
    state.err = t('InvalidEmail');
    return;
  }
  try {

    if ( await authn.login(state.email,state.password) ) {
      state.err = '';
      emit('success');
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

<template>
  <form class="welcome-card-form"
        @submit.prevent="doLogin"
        novalidate>
    <component :is="props.headingLevel">{{ t('title') }}</component>

    <ErrorAlert id="login-error" :error="state.err" />

    <div class="form-stack">
      <label for="login-email" class="sr-only">{{ t('email') }}</label>
      <input type="email"
             id="login-email"
             autofocus
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

      <button class="btn btn--primary"
              type="submit"
              :aria-describedby="state.err ? 'login-error' : undefined">
        {{ t("login_button") }}
      </button>
    </div>

    <div v-if="registrationMode == 'open' || registrationMode == 'apply'"
         class="secondary-actions">
      <router-link v-if="registrationMode == 'open'"
                   :to="{ name: 'register', query: { email: state.email}}">
        {{ t("register_button") }}
      </router-link>
      <router-link v-if="registrationMode == 'apply'"
                   :to="{ name: 'register-apply', query: { email: state.email}}">
        {{ t("apply_button") }}
      </router-link>
    </div>

    <router-link class="forgot"
                 :to="{ name: 'forgot_password', query: { email: state.email }}">
      {{ t("forgot_password") }}
    </router-link>
  </form>
</template>

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
