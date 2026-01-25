<template>
  <!-- Success state -->
  <div v-if="state.showSuccess" class="welcome-card">
    <SuccessState>
      <h3 class="success-heading">{{ t('success_title') }}</h3>
      <p class="success-message">
        {{ t('success_message', { email: state.email }) }}
      </p>
    </SuccessState>
    <router-link
      class="forgot"
      :to="{ name: 'login', query: { email: state.email }}"
    >
      {{ t("login_link") }}
    </router-link>
  </div>

  <!-- Form state -->
  <form
    v-else
    class="welcome-card"
    @submit.prevent="startReset"
    novalidate
  >
    <h3>{{ t('title') }}</h3>
    <p class="instructions">{{ t('instructions') }}</p>

    <ErrorAlert :error="state.error" />

    <div class="form-stack">
      <label for="reset-email" class="sr-only">{{ t('email') }}</label>
      <input
        type="email"
        id="reset-email"
        name="email"
        :placeholder="t('email')"
        v-model="state.email"
        autocomplete="email"
        required
      />

      <button type="submit">
        {{ t('go_button') }}
      </button>
    </div>

    <router-link
      class="forgot"
      :to="{ name: 'login', query: { email: state.email }}"
    >
      {{ t("login_link") }}
    </router-link>
  </form>
</template>

<script setup>
import { reactive, inject } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import ErrorAlert from './ErrorAlert.vue';
import SuccessState from './SuccessState.vue';

const { t } = useTranslation('authentication', {
  keyPrefix: 'forgot_password',
});
const authentication = inject('authn');

const router = useRouter();
const route = useRoute();
const state = reactive({
  error: route.query.err,
  email: route.query.email,
  showSuccess: false,
});

async function startReset() {
  try {
    await authentication.reset_password( state.email );
    state.showSuccess = true;
  }
  catch(error) {
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

    state.error = t( error_text ) || error_text;
  }
}
</script>

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
