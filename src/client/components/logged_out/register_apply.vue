<template>
  <!-- Success state -->
  <div v-if="state.showSuccess" class="welcome-card">
    <SuccessState>
      <h3>{{ t('title') }}</h3>
      <p class="success-message">
        {{ t('application_submitted') }}
      </p>
    </SuccessState>
  </div>

  <!-- Form state -->
  <form
    v-else
    class="welcome-card"
    @submit.prevent="doApply"
    novalidate
  >
    <h3>{{ t('title') }}</h3>

    <ErrorAlert :error="state.err" />

    <div class="form-stack">
      <label for="apply-email" class="sr-only">{{ t('email') }}</label>
      <input
        type="email"
        id="apply-email"
        :class="{ 'form-control--error': state.err }"
        :placeholder="t('email')"
        v-model="state.email"
        :aria-invalid="state.err ? 'true' : 'false'"
        :aria-describedby="state.err ? 'apply-error' : undefined"
        autocomplete="email"
        required
      />

      <div class="textarea-field">
        <label for="apply-message" class="textarea-label">
          {{ t('message_label') }}
        </label>
        <textarea
          id="apply-message"
          class="textarea"
          :class="{ 'form-control--error': state.err }"
          v-model="state.message"
          :aria-invalid="state.err ? 'true' : 'false'"
          :aria-describedby="state.err ? 'apply-error' : undefined"
          rows="6"
          required
        />
      </div>

      <button
        class="primary"
        type="submit"
        :aria-describedby="state.err ? 'apply-error' : undefined"
      >
        {{ t("create_button") }}
      </button>
    </div>

    <router-link
      class="forgot"
      :to="{ name: 'login', query: { email: state.email}}"
    >
      {{ t("go_login") }}
    </router-link>
  </form>
</template>

<script setup>
import { reactive, onBeforeMount, inject } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import ErrorAlert from './ErrorAlert.vue';
import SuccessState from './SuccessState.vue';

const router = useRouter();
const authn = inject('authn');
const { t } = useTranslation('registration', {
  keyPrefix: 'apply',
});

const props = defineProps(['error', 'em']);
const state = reactive({
  err      : '',
  email    : '',
  message  : '',
  showSuccess: false,
});
const route = useRoute();

onBeforeMount(() => {
  if ( route.query.code ) {
    router.push({ name: 'reset_password', query: { code: route.query.code }});
  }

  state.err   = state.error || '';
  state.email = state.em || '';
});

async function doApply() {
  if ( state.email == '' || state.message == '' ) {
    state.err = t('MissingFields');
    return;
  }
  try {

    await authn.register_apply(state.email,state.message);
    state.err = '';
    state.showSuccess = true;
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

.textarea-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem; /* 8px */

  .textarea-label {
    font-size: 1rem; /* 16px */
    font-weight: var(--pav-font-weight-medium);
    color: var(--pav-color-stone-800);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-200);
    }
  }

  .textarea {
    width: 100%;
    border-radius: 1rem; /* 16px - rounded-2xl */
    border: 1px solid var(--pav-color-stone-300);
    padding: 1.125rem 1.5rem; /* 18px 24px */
    font-size: 1.125rem; /* 18px */
    background-color: white;
    color: var(--pav-color-stone-900);
    resize: vertical;
    transition: all 0.2s ease-in-out;

    &::placeholder {
      color: var(--pav-color-stone-400);
    }

    &:focus {
      outline: none;
      border-color: var(--pav-color-orange-400);
      box-shadow: 0 0 0 3px rgb(249 115 22 / 0.4);
    }

    @media (prefers-color-scheme: dark) {
      background-color: var(--pav-color-stone-700);
      border-color: var(--pav-color-stone-600);
      color: var(--pav-color-stone-100);

      &::placeholder {
        color: var(--pav-color-stone-500);
      }
    }

    &.form-control--error {
      border-color: rgb(239 68 68); /* red-500 */

      @media (prefers-color-scheme: dark) {
        border-color: rgb(185 28 28); /* red-700 */
      }
    }
  }
}

.success-message {
  font-size: 1.125rem; /* 18px */
  color: var(--pav-color-stone-600);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-300);
  }
}
</style>
