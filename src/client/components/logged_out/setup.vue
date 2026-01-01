<template>
  <div class="setup-container">
    <!-- Success state after setup is complete -->
    <div v-if="state.setupComplete"
         class="welcome-card setup-card">
      <div class="alert alert--success"
           role="alert"
           aria-live="polite">
        <h3>{{ t('success_title') }}</h3>
        <p>{{ t('success_message') }}</p>
      </div>
      <button class="primary"
              type="button"
              @click="navigateToLogin">
        {{ t('continue_to_login') }}
      </button>
    </div>

    <!-- Language selection card (shown first) -->
    <div v-else-if="!state.languageSelected"
         class="welcome-card setup-card language-card">
      <h3>{{ t('language_select_title') }}</h3>
      <p class="setup-description">{{ t('language_select_description') }}</p>

      <div class="form-group">
        <select id="setup-language-select"
                class="form-control"
                v-model="state.defaultLanguage"
                @change="selectLanguage(state.defaultLanguage)">
          <option v-for="lang in AVAILABLE_LANGUAGES"
                  :key="lang.code"
                  :value="lang.code">
            {{ lang.nativeName }}
          </option>
        </select>
      </div>

      <button class="primary"
              type="button"
              @click="proceedToSetup">
        {{ t('continue_button') }}
      </button>
    </div>

    <!-- Setup form -->
    <form v-else
          class="welcome-card setup-card"
          @submit.prevent="handleSubmit"
          novalidate>
      <h3>{{ t('title') }}</h3>
      <p class="setup-description">{{ t('description') }}</p>

      <!-- Error alert -->
      <div class="alert alert--error alert--sm"
           v-if="state.formError"
           role="alert"
           aria-live="polite"
           :aria-describedby="state.formError ? 'setup-error' : undefined">
        <span id="setup-error">{{ translateError(state.formError) }}</span>
      </div>

      <fieldset class="form-stack">
        <!-- Email field -->
        <div class="form-group">
          <label for="setup-email" class="sr-only">{{ t('email_label') }}</label>
          <input type="email"
                 id="setup-email"
                 class="form-control"
                 :class="{ 'form-control--error': state.formError }"
                 :placeholder="t('email_placeholder')"
                 v-model="state.email"
                 autocomplete="email"
                 required />
        </div>

        <!-- Password field -->
        <div class="form-group">
          <label for="setup-password" class="sr-only">{{ t('password_label') }}</label>
          <input type="password"
                 id="setup-password"
                 class="form-control"
                 :class="{ 'form-control--error': state.passwordError || state.formError }"
                 :placeholder="t('password_placeholder')"
                 v-model="state.password"
                 @blur="validatePasswordField"
                 autocomplete="new-password"
                 required />
          <div v-if="state.passwordError"
               class="password-validation-error"
               role="alert">
            {{ translateError(state.passwordError) }}
          </div>
        </div>

        <!-- Password confirmation field -->
        <div class="form-group">
          <label for="setup-password-confirm" class="sr-only">{{ t('password_confirm_label') }}</label>
          <input type="password"
                 id="setup-password-confirm"
                 class="form-control"
                 :class="{ 'form-control--error': state.formError }"
                 :placeholder="t('password_confirm_placeholder')"
                 v-model="state.passwordConfirm"
                 autocomplete="new-password"
                 required />
        </div>

        <!-- Site title field -->
        <div class="form-group">
          <label for="setup-site-title" class="sr-only">{{ t('site_title_label') }}</label>
          <input type="text"
                 id="setup-site-title"
                 class="form-control"
                 :class="{ 'form-control--error': state.formError }"
                 :placeholder="t('site_title_placeholder')"
                 v-model="state.siteTitle"
                 required />
          <div class="field-description">{{ t('site_title_description') }}</div>
        </div>

        <!-- Registration mode dropdown -->
        <div class="form-group">
          <label for="setup-registration-mode">{{ t('registration_mode_label') }}</label>
          <select id="setup-registration-mode"
                  class="form-control"
                  v-model="state.registrationMode"
                  required>
            <option value="open">{{ t('registration_mode_open') }}</option>
            <option value="apply">{{ t('registration_mode_apply') }}</option>
            <option value="invitation">{{ t('registration_mode_invitation') }}</option>
            <option value="closed">{{ t('registration_mode_closed') }}</option>
          </select>
          <div class="field-description">{{ t('registration_mode_description') }}</div>
        </div>

        <!-- Action buttons -->
        <div class="button-group">
          <button class="secondary"
                  type="button"
                  @click="goBackToLanguage">
            {{ t('back_button') }}
          </button>
          <button class="primary"
                  type="submit"
                  :disabled="state.submitting">
            {{ state.submitting ? t('submitting_button') : t('submit_button') }}
          </button>
        </div>
      </fieldset>
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

.setup-card {
  max-width: 440px;
  width: 100%;

  h3 {
    margin-bottom: 0.5rem;
    font-size: 1.5rem;
    font-weight: $font-medium;
    color: $light-mode-text;
    text-align: center;

    @include dark-mode {
      color: $dark-mode-text;
    }
  }

  .setup-description {
    margin-bottom: 1.5rem;
    font-size: 0.9rem;
    color: $light-mode-secondary-text;
    text-align: center;

    @include dark-mode {
      color: $dark-mode-secondary-text;
    }
  }

  .form-group {
    margin-bottom: 1rem;

    label:not(.sr-only) {
      display: block;
      margin-bottom: 0.5rem;
      font-weight: $font-medium;
      font-size: 0.9rem;
      color: $light-mode-text;

      @include dark-mode {
        color: $dark-mode-text;
      }
    }
  }

  .field-description {
    margin-top: 0.25rem;
    font-size: 0.8rem;
    color: $light-mode-secondary-text;

    @include dark-mode {
      color: $dark-mode-secondary-text;
    }
  }

  .password-validation-error {
    margin-top: 0.25rem;
    font-size: 0.8rem;
    color: #c62828;

    @include dark-mode {
      color: #ef5350;
    }
  }

  select.form-control {
    width: 100%;
    padding: var(--pav-space-sm, 8px) var(--pav-space-md, 12px);
    border-radius: var(--pav-border-radius-full, 20px);
    border: 1px solid var(--pav-border-color-medium, #ccc);
    font-size: var(--pav-font-size-base, 14px);
    background-color: var(--pav-surface-primary, #fff);
    cursor: pointer;
    appearance: auto;

    @include dark-mode {
      background-color: $dark-mode-input-background;
      border-color: #555;
      color: $dark-mode-input-text;
    }

    &:focus {
      outline: none;
      border-color: $focus-color;
      box-shadow: 0 0 0 2px rgba($focus-color, 0.2);

      @include dark-mode {
        border-color: $focus-color-dark;
        box-shadow: 0 0 0 2px rgba($focus-color-dark, 0.2);
      }
    }
  }

  button.primary {
    width: 100%;
    margin-top: 1rem;
  }

  .button-group {
    display: flex;
    gap: 0.75rem;
    margin-top: 1rem;

    button {
      flex: 1;
      margin-top: 0;
    }
  }

  button.secondary {
    width: 100%;
    padding: 0.75rem 1rem;
    border: 2px solid #ddd;
    border-radius: var(--pav-border-radius-full, 20px);
    background: transparent;
    font-size: 1rem;
    font-weight: $font-medium;
    cursor: pointer;
    transition: all 0.2s ease;
    color: $light-mode-text;

    @include dark-mode {
      border-color: #555;
      color: $dark-mode-text;
    }

    &:hover {
      border-color: $focus-color;
      background-color: rgba($focus-color, 0.05);

      @include dark-mode {
        border-color: $focus-color-dark;
        background-color: rgba($focus-color-dark, 0.1);
      }
    }
  }

  .alert--success {
    text-align: center;
    margin-bottom: 1.5rem;

    h3 {
      margin-bottom: 0.5rem;
    }

    p {
      margin: 0;
    }
  }

}
</style>
