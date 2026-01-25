<template>
  <div class="setup-container">
    <!-- Success State -->
    <div v-if="state.setupComplete" class="welcome-card">
      <SuccessState>
        <h3 class="success-heading">{{ t('success_title') }}</h3>
        <p class="success-message">{{ t('success_message') }}</p>
      </SuccessState>

      <button type="button" @click="navigateToLogin">
        {{ t('continue_to_login') }}
      </button>
    </div>

    <!-- Language Selection -->
    <div v-else-if="!state.languageSelected" class="welcome-card">
      <h3>{{ t('language_select_title') }}</h3>
      <p class="instructions">{{ t('language_select_description') }}</p>

      <div class="form-stack">
        <div class="form-field">
          <label for="setup-language-select">{{ t('language_label') }}</label>
          <select
            id="setup-language-select"
            v-model="state.defaultLanguage"
            @change="selectLanguage(state.defaultLanguage)"
          >
            <option
              v-for="lang in AVAILABLE_LANGUAGES"
              :key="lang.code"
              :value="lang.code"
            >
              {{ lang.nativeName }}
            </option>
          </select>
        </div>

        <button type="button" @click="proceedToSetup">
          {{ t('continue_button') }}
        </button>
      </div>
    </div>

    <!-- Setup Form -->
    <form
      v-else
      class="welcome-card"
      @submit.prevent="handleSubmit"
      novalidate
    >
      <h3>{{ t('title') }}</h3>
      <p class="instructions">{{ t('description') }}</p>

      <ErrorAlert
        :error="state.passwordError ? translateError(state.passwordError) : (state.formError ? translateError(state.formError) : '')"
      />

      <div class="form-stack">
        <label for="setup-email" class="sr-only">{{ t('email_label') }}</label>
        <input
          type="email"
          id="setup-email"
          :placeholder="t('email_placeholder')"
          v-model="state.email"
          autocomplete="email"
          required
        />

        <label for="setup-password" class="sr-only">{{ t('password_label') }}</label>
        <input
          type="password"
          id="setup-password"
          :placeholder="t('password_placeholder')"
          v-model="state.password"
          @blur="validatePasswordField"
          autocomplete="new-password"
          required
        />

        <label for="setup-password-confirm" class="sr-only">{{ t('password_confirm_label') }}</label>
        <input
          type="password"
          id="setup-password-confirm"
          :placeholder="t('password_confirm_placeholder')"
          v-model="state.passwordConfirm"
          autocomplete="new-password"
          required
        />

        <div class="form-field">
          <label for="setup-site-title">{{ t('site_title_label') }}</label>
          <input
            type="text"
            id="setup-site-title"
            :placeholder="t('site_title_placeholder')"
            v-model="state.siteTitle"
            required
          />
          <div class="field-description">{{ t('site_title_description') }}</div>
        </div>

        <div class="form-field">
          <label for="setup-registration-mode">{{ t('registration_mode_label') }}</label>
          <select id="setup-registration-mode" v-model="state.registrationMode" required>
            <option value="open">{{ t('registration_mode_open') }}</option>
            <option value="apply">{{ t('registration_mode_apply') }}</option>
            <option value="invitation">{{ t('registration_mode_invitation') }}</option>
            <option value="closed">{{ t('registration_mode_closed') }}</option>
          </select>
          <div class="field-description">{{ t('registration_mode_description') }}</div>
        </div>

        <div class="button-group">
          <button class="secondary" type="button" @click="goBackToLanguage">
            {{ t('back_button') }}
          </button>
          <button type="submit" :disabled="state.submitting">
            {{ state.submitting ? t('submitting_button') : t('submit_button') }}
          </button>
        </div>
      </div>
    </form>
  </div>
</template>

<script setup>
import { inject, reactive, onMounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import i18next from 'i18next';
import { validatePassword } from '@/common/validation/password';
import { AVAILABLE_LANGUAGES, getBrowserLanguage } from '@/common/i18n/languages';
import SetupService from '@/client/service/setup';
import ErrorAlert from './ErrorAlert.vue';
import SuccessState from './SuccessState.vue';

// Allow injection of setup service for testing
const injectedSetupService = inject('setupService', null);
const setupService = injectedSetupService || new SetupService();

const { t } = useTranslation('setup');

// Detect browser language for initial setup screen
const detectedLanguage = getBrowserLanguage();

const state = reactive({
  email: '',
  password: '',
  passwordConfirm: '',
  siteTitle: '',
  registrationMode: 'invitation',
  defaultLanguage: detectedLanguage,
  languageSelected: false,
  formError: '',
  passwordError: '',
  submitting: false,
  setupComplete: false,
});

// Set UI language to browser language on mount
onMounted(() => {
  i18next.changeLanguage(detectedLanguage);
});

/**
 * Selects a language and updates the UI immediately.
 */
function selectLanguage(langCode) {
  state.defaultLanguage = langCode;
  i18next.changeLanguage(langCode);
}

/**
 * Proceeds from language selection to the main setup form.
 */
function proceedToSetup() {
  state.languageSelected = true;
}

/**
 * Goes back to language selection from the main setup form.
 */
function goBackToLanguage() {
  state.languageSelected = false;
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
    // Use the first error
    state.passwordError = validation.errors[0];
  }
  else {
    state.passwordError = '';
  }
}

/**
 * Translates error keys to user-facing messages.
 */
function translateError(errorKey) {
  // Map known error keys to translation keys
  const errorMap = {
    'password_too_short': 'password_too_short',
    'password_needs_variety': 'password_needs_variety',
    'setup_already_completed': 'error_setup_already_completed',
  };

  const translationKey = errorMap[errorKey] || errorKey;

  // Try to translate, fall back to error key
  const translated = t(translationKey);
  return translated !== translationKey ? translated : t('error_unknown');
}

/**
 * Validates the form before submission.
 * @returns {boolean} True if form is valid
 */
function validateForm() {
  // Required field validation
  if (!state.email) {
    state.formError = 'error_missing_email';
    return false;
  }

  if (!state.password) {
    state.formError = 'error_missing_password';
    return false;
  }

  if (!state.passwordConfirm) {
    state.formError = 'error_missing_password_confirm';
    return false;
  }

  if (!state.siteTitle) {
    state.formError = 'error_missing_site_title';
    return false;
  }

  // Password validation
  const passwordValidation = validatePassword(state.password);
  if (!passwordValidation.valid) {
    state.formError = passwordValidation.errors[0];
    return false;
  }

  // Password match validation
  if (state.password !== state.passwordConfirm) {
    state.formError = 'error_passwords_mismatch';
    return false;
  }

  return true;
}

/**
 * Navigates to the login page using a full page reload.
 * This is necessary because the router's global navigation guard
 * blocks vue-router navigation while isSetupMode is true.
 */
function navigateToLogin() {
  window.location.href = '/auth/login';
}

/**
 * Handles form submission.
 */
async function handleSubmit() {
  state.formError = '';

  if (!validateForm()) {
    return;
  }

  state.submitting = true;

  try {
    await setupService.completeSetup({
      email: state.email,
      password: state.password,
      siteTitle: state.siteTitle,
      registrationMode: state.registrationMode,
      defaultLanguage: state.defaultLanguage,
    });

    // Show success state
    state.setupComplete = true;
  }
  catch (error) {
    let errorMessage = 'error_unknown';

    if (error instanceof Error) {
      errorMessage = error.message;
    }
    else if (typeof error === 'string') {
      errorMessage = error;
    }

    state.formError = errorMessage;
  }
  finally {
    state.submitting = false;
  }
}
</script>

<style scoped lang="scss">
@use '../../assets/mixins' as *;

.setup-container {
  display: flex;
  justify-content: center;
  width: 100%;
}

.instructions {
  font-size: 1.125rem; /* 18px */
  color: var(--pav-color-stone-600);
  margin-bottom: 2rem; /* 32px */
  text-align: center;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-300);
  }
}

.form-stack {
  display: flex;
  flex-direction: column;
  gap: 1.5rem; /* 24px */
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem; /* 8px */

  label {
    font-size: 1rem; /* 16px */
    font-weight: var(--pav-font-weight-medium);
    color: var(--pav-color-stone-800);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-200);
    }
  }

  select {
    width: 100%;
    border-radius: 9999px; /* Pill shape */
    border: 1px solid var(--pav-color-stone-300);
    padding: 1.125rem 1.5rem; /* 18px 24px */
    font-size: 1.125rem; /* 18px */
    background-color: white;
    color: var(--pav-color-stone-900);
    cursor: pointer;
    transition: all 0.2s ease-in-out;

    &:focus {
      outline: none;
      border-color: var(--pav-color-orange-400);
      box-shadow: 0 0 0 3px rgb(249 115 22 / 0.4);
    }

    @media (prefers-color-scheme: dark) {
      background-color: var(--pav-color-stone-700);
      border-color: var(--pav-color-stone-600);
      color: var(--pav-color-stone-100);
    }
  }

  .field-description {
    font-size: 0.875rem; /* 14px */
    color: var(--pav-color-stone-600);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }
}

.button-group {
  display: flex;
  gap: 1rem; /* 16px */
  margin-top: 0.5rem;

  button {
    flex: 1;
  }

  button.secondary {
    border-radius: 9999px;
    padding: 1.125rem 1.5rem; /* 18px 24px */
    font-size: 1.125rem; /* 18px */
    font-weight: var(--pav-font-weight-medium);
    background-color: white;
    border: 1px solid var(--pav-color-stone-300);
    color: var(--pav-color-stone-700);
    cursor: pointer;
    transition: all 0.2s ease-in-out;

    &:hover:not(:disabled) {
      border-color: var(--pav-color-orange-400);
      color: var(--pav-color-orange-600);
    }

    @media (prefers-color-scheme: dark) {
      background-color: var(--pav-color-stone-800);
      border-color: var(--pav-color-stone-600);
      color: var(--pav-color-stone-300);

      &:hover:not(:disabled) {
        border-color: var(--pav-color-orange-400);
        color: var(--pav-color-orange-400);
      }
    }
  }
}

.success-heading {
  text-align: center;
}

.success-message {
  font-size: 1.125rem; /* 18px */
  color: var(--pav-color-stone-600);
  text-align: center;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-300);
  }
}
</style>
