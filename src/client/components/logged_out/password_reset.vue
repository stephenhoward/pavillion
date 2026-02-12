<template>
  <!-- Code Entry Step -->
  <form
    v-if="!state.codeValidated"
    class="welcome-card"
    @submit.prevent="submitResetCode"
    novalidate
  >
    <h3>{{ t('check_email_title') }}</h3>
    <p class="instructions">{{ t('check_email') }} {{ state.email }}.</p>

    <ErrorAlert :error="state.form_error ? t(state.form_error) : ''" />

    <div class="form-stack">
      <label for="reset-code" class="sr-only">{{ t('reset_code') }}</label>
      <input
        type="text"
        id="reset-code"
        :placeholder="t('reset_code')"
        v-model="state.reset_code"
        autocomplete="one-time-code"
        required
      />

      <button type="submit">
        {{ t('reset_button') }}
      </button>
    </div>

    <router-link
      class="forgot"
      :to="{ name: 'login', query: { email: state.email }}"
    >
      {{ t("login_link") }}
    </router-link>
  </form>

  <!-- Password Entry Step -->
  <form
    v-else
    class="welcome-card"
    @submit.prevent="setPassword"
    novalidate
  >
    <h3>{{ state.isRegistration ? t('new_account_password_title') : t('code_validated_title') }}</h3>
    <p class="instructions">{{ state.isRegistration ? t('registration_new_password') : t('set_password_prompt') }}</p>

    <ErrorAlert :error="state.passwordError ? translateError(state.passwordError) : (state.form_error ? translateError(state.form_error) : '')" />

    <div class="form-stack">
      <label for="new-password" class="sr-only">{{ t('password_placeholder') }}</label>
      <input
        type="password"
        id="new-password"
        :placeholder="t('password_placeholder')"
        v-model="state.password"
        @blur="validatePasswordField"
        autocomplete="new-password"
        required
      />

      <label for="confirm-password" class="sr-only">{{ t('password2_placeholder') }}</label>
      <input
        type="password"
        id="confirm-password"
        :placeholder="t('password2_placeholder')"
        v-model="state.password2"
        autocomplete="new-password"
        @keyup.enter="setPassword"
        required
      />

      <button type="submit">
        {{ t("set_password_button") }}
      </button>
    </div>
  </form>
</template>

<style scoped lang="scss">
.instructions {
  font-size: 1.125rem; /* 18px */
  color: var(--pav-color-stone-600);
  margin-bottom: 2rem; /* 32px */

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-300);
  }
}

.form-stack {
  display: flex;
  flex-direction: column;
  gap: 1.5rem; /* 24px */
}
</style>

<script setup lang="ts">
import { reactive, onBeforeMount, inject } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { validatePassword } from '@/common/validation/password';
import ErrorAlert from './ErrorAlert.vue';

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
  isRegistration: false,
  password: '',
  password2: '',
  form_error: '',
  passwordError: '',
});

onBeforeMount(async () => {
  if (state.reset_code) {
    console.log("checking password reset token");
    await submitResetCode();
  }
});

async function submitResetCode() {
  state.form_error = '';
  const response = await authn.check_password_reset_token(state.reset_code);

  if (response && response.valid) {
    state.codeValidated = true;
    state.isRegistration = response.isNewAccount || false;
  }
  else {
    state.form_error = 'bad_token';
  }
}

/**
 * Validates the password field and sets appropriate error state.
 */
function validatePasswordField() {
  if (!state.password) {
    state.passwordError = '';
    return;
  }

  const validation = validatePassword(state.password);
  if (!validation.valid) {
    state.passwordError = validation.errors[0];
  }
  else {
    state.passwordError = '';
  }
}

/**
 * Translates error keys to user-facing messages.
 */
function translateError(errorKey: string) {
  // Map known error keys to translation keys
  const errorMap: Record<string, string> = {
    'password_too_short': 'password_too_short',
    'password_needs_variety': 'password_needs_variety',
  };

  const translationKey = errorMap[errorKey] || errorKey;

  // Try to translate, fall back to the t() function result
  const translated = t(translationKey);
  return translated !== translationKey ? translated : t(errorKey);
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
    // Validate password strength
    const passwordValidation = validatePassword(state.password);
    if (!passwordValidation.valid) {
      state.form_error = passwordValidation.errors[0];
      return;
    }

    state.form_error = '';
    try {
      await authn.use_password_reset_token(state.reset_code, state.password);
      router.push('/auth/login');
    }
    catch (error: unknown) {
      let errorKey = 'unknown_error';

      // Type guard - check if error is an object with response property
      if (error && typeof error === 'object' && 'response' in error) {
        const responseError = error as any;
        if (responseError.response && responseError.response.data) {
          const data = responseError.response.data;
          // Prefer errorName field for structured errors
          if (data.errorName && typeof data.errorName === 'string') {
            errorKey = data.errorName;
          }
          // Fallback to error field for legacy responses
          else if (data.error && typeof data.error === 'string') {
            errorKey = data.error;
          }
        }
      }
      // Handle string errors
      else if (typeof error === 'string') {
        errorKey = error;
      }

      state.form_error = t(errorKey);
    }
  }
}

</script>
