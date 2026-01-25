<template>
  <!-- Expired Invitation State -->
  <div v-if="!state.codeValidated" class="welcome-card">
    <h3>{{ t('bad_invite_title') }}</h3>
    <p class="instructions">{{ t('bad_invite_explanation') }}</p>

    <router-link
      class="forgot"
      :to="{ name: 'login', query: { email: state.email }}"
    >
      {{ t("go_login") }}
    </router-link>
  </div>

  <!-- Success State -->
  <div v-else-if="state.invitationAccepted" class="welcome-card">
    <SuccessState>
      <h3 class="success-heading">{{ t('invitation_accepted_title') }}</h3>
      <p class="success-message">{{ t('invitation_accepted_description') }}</p>

      <!-- Calendar access information -->
      <div
        v-if="state.calendarAccess && state.calendarAccess.length"
        class="calendar-access-info"
      >
        <h4>{{ t('calendar_access_granted_title') }}</h4>
        <ul class="calendar-list">
          <li
            v-for="calendar in state.calendarAccess"
            :key="calendar.calendarId"
            class="calendar-item"
          >
            <strong>{{ calendar.calendarName }}</strong>
            <span class="invited-by">{{ t('invited_by', { email: calendar.invitedBy }) }}</span>
          </li>
        </ul>
      </div>
    </SuccessState>

    <router-link class="forgot" to="/auth/login">
      {{ t('continue_to_login') }}
    </router-link>
  </div>

  <!-- Password Setup Form -->
  <form
    v-else
    class="welcome-card"
    @submit.prevent="setPassword"
    novalidate
  >
    <h3>{{ t('new_account_password_title') }}</h3>
    <p class="instructions">{{ t('registration_new_password') }}</p>

    <ErrorAlert :error="state.passwordError ? translateError(state.passwordError) : (state.form_error ? translateError(state.form_error) : '')" />

    <div class="form-stack">
      <label for="invite-password" class="sr-only">{{ t('password_placeholder') }}</label>
      <input
        type="password"
        id="invite-password"
        :placeholder="t('password_placeholder')"
        v-model="state.password"
        @blur="validatePasswordField"
        autocomplete="new-password"
        required
      />

      <label for="invite-password2" class="sr-only">{{ t('password2_placeholder') }}</label>
      <input
        type="password"
        id="invite-password2"
        :placeholder="t('password2_placeholder')"
        v-model="state.password2"
        autocomplete="new-password"
        @keyup.enter="setPassword"
        required
      />

      <button type="submit">
        {{ t('set_password_button') || 'Set Password' }}
      </button>
    </div>
  </form>
</template>



<script setup>
import { inject, onBeforeMount, reactive } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { validatePassword } from '@/common/validation/password';
import ErrorAlert from './ErrorAlert.vue';
import SuccessState from './SuccessState.vue';

const router = useRouter();
const route = useRoute();
const authn = inject('authn');

const { t } = useTranslation('registration', {
  keyPrefix: 'accept_invite',
});


const state = reactive({
  form_error: '',
  passwordError: '',
  invite_code: route.query.code || '',
  codeValidated: false,
  password: '',
  password2: '',
  invitationAccepted: false,
  calendarAccess: [],
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
function translateError(errorKey) {
  // Map known error keys to translation keys
  const errorMap = {
    'password_too_short': 'password_too_short',
    'password_needs_variety': 'password_needs_variety',
  };

  const translationKey = errorMap[errorKey] || errorKey;

  // Try to translate, fall back to error key
  const translated = t(translationKey);
  return translated !== translationKey ? translated : errorKey;
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

  // Validate password strength
  const passwordValidation = validatePassword(state.password);
  if (!passwordValidation.valid) {
    state.form_error = passwordValidation.errors[0];
    return;
  }

  state.form_error = '';
  try {
    const response = await authn.accept_invitation(state.invite_code, state.password);

    // Handle enhanced response with calendar information
    if (response && response.calendars && response.calendars.length > 0) {
      state.calendarAccess = response.calendars;
      state.invitationAccepted = true;
    }
    else {
      // For admin invitations or invitations without calendar context,
      // go directly to login as before
      router.push('/auth/login');
    }
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

<style scoped lang="scss">
@use '../../assets/mixins' as *;

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

.calendar-access-info {
  margin-top: 1.5rem; /* 24px */
  padding: 1.5rem; /* 24px */
  background-color: var(--pav-color-stone-100);
  border-radius: 1rem; /* 16px - rounded-2xl */

  @media (prefers-color-scheme: dark) {
    background-color: var(--pav-color-stone-800);
  }

  h4 {
    margin: 0 0 1rem 0;
    font-size: 1rem; /* 16px */
    font-weight: var(--pav-font-weight-medium);
    color: var(--pav-color-stone-800);
    text-align: center;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-200);
    }
  }
}

.calendar-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.calendar-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1rem; /* 16px */
  margin-bottom: 0.75rem; /* 12px */
  background-color: white;
  border: 1px solid var(--pav-color-stone-200);
  border-radius: 0.75rem; /* 12px - rounded-xl */

  @media (prefers-color-scheme: dark) {
    background-color: var(--pav-color-stone-700);
    border-color: var(--pav-color-stone-600);
  }

  strong {
    font-weight: var(--pav-font-weight-medium);
    color: var(--pav-color-stone-900);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }

  .invited-by {
    font-size: 0.875rem; /* 14px */
    color: var(--pav-color-stone-600);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }

  &:last-child {
    margin-bottom: 0;
  }
}
</style>
