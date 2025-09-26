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

  <!-- Success state after password is set -->
  <div v-else-if="state.invitationAccepted"
       class="card card--elevated vstack stack--lg card__content">
    <div class="alert alert--success alert--sm" role="alert" aria-live="polite">
      <h3>{{ t('invitation_accepted_title') }}</h3>
      <p>{{ t('invitation_accepted_description') }}</p>

      <!-- Calendar access information -->
      <div v-if="state.calendarAccess && state.calendarAccess.length"
           class="calendar-access-info">
        <h4>{{ t('calendar_access_granted_title') }}</h4>
        <ul class="calendar-list">
          <li v-for="calendar in state.calendarAccess"
              :key="calendar.calendarId"
              class="calendar-item">
            <strong>{{ calendar.calendarName }}</strong>
            <span class="invited-by">{{ t('invited_by', { email: calendar.invitedBy }) }}</span>
          </li>
        </ul>
      </div>
    </div>

    <router-link class="primary"
                 to="/auth/login"
                 role="button">
      {{ t('continue_to_login') }}
    </router-link>
  </div>

  <!-- Password setup form -->
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

.calendar-access-info {
  margin-top: 1rem;
  padding: 1rem;
  background-color: rgba(0, 0, 0, 0.05);
  border-radius: 8px;

  @media (prefers-color-scheme: dark) {
    background-color: rgba(255, 255, 255, 0.05);
  }

  h4 {
    margin: 0 0 0.75rem 0;
    font-size: 1rem;
    font-weight: $font-medium;
    color: $light-mode-text;

    @media (prefers-color-scheme: dark) {
      color: $dark-mode-text;
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
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  background-color: $light-mode-background;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 6px;

  @media (prefers-color-scheme: dark) {
    background-color: $dark-mode-background;
    border-color: rgba(255, 255, 255, 0.1);
  }

  strong {
    font-weight: $font-medium;
    color: $light-mode-text;

    @media (prefers-color-scheme: dark) {
      color: $dark-mode-text;
    }
  }

  .invited-by {
    font-size: 0.875rem;
    color: rgba(0, 0, 0, 0.7);

    @media (prefers-color-scheme: dark) {
      color: rgba(255, 255, 255, 0.7);
    }
  }

  &:last-child {
    margin-bottom: 0;
  }
}

@media (max-width: 480px) {
  .calendar-access-info {
    padding: 0.75rem;
  }

  .calendar-item {
    padding: 0.5rem;
  }
}
</style>
