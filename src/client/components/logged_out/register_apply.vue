<template>
  <div>
    <!-- Success state -->
    <div v-show="state.showSuccess" class="welcome-card">
      <SuccessState>
        <h3>{{ t('title') }}</h3>
        <p class="success-message">
          {{ t('application_submitted') }}
        </p>
      </SuccessState>
    </div>

    <!-- Form state -->
    <form
      v-show="!state.showSuccess"
      class="welcome-card"
      @submit.prevent="doApply"
      novalidate
    >
      <h3>{{ t('title') }}</h3>

      <PolicyLink source="register-apply" />

      <ErrorAlert id="apply-error" :error="state.err" />

      <div class="form-stack">
        <label for="apply-email" class="sr-only">{{ t('email') }}</label>
        <input
          type="email"
          id="apply-email"
          :class="['auth-field', { 'form-control--error': state.err }]"
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
          class="btn btn--pill btn--primary"
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
  </div>
</template>

<script setup>
import { reactive, onBeforeMount, inject } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { isValidEmail } from '@/common/validation/email';
import ErrorAlert from './error-alert.vue';
import SuccessState from './success-state.vue';
import PolicyLink from '@/client/components/common/PolicyLink.vue';

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

  state.err   = props.error || '';
  state.email = props.em || '';
});

async function doApply() {
  if ( state.email == '' || state.message == '' ) {
    state.err = t('MissingFields');
    return;
  }
  if ( !isValidEmail(state.email) ) {
    state.err = t('InvalidEmail');
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
    color: var(--pav-text-primary);
  }

  .textarea {
    width: 100%;
    border-radius: 1rem; /* 16px - rounded-2xl */
    border: 1px solid var(--pav-border-color-medium);
    padding: 1.125rem 1.5rem; /* 18px 24px */
    font-size: 1.125rem; /* 18px */
    background-color: var(--pav-surface-primary);
    color: var(--pav-text-primary);
    resize: vertical;
    transition: all 0.2s ease-in-out;

    &::placeholder {
      color: var(--pav-text-muted);
    }

    &:focus {
      outline: none;
      border-color: var(--pav-color-orange-400);
      box-shadow: var(--pav-shadow-focus-brand);
    }

    &.form-control--error {
      border-color: var(--pav-color-border-error);
    }
  }
}

.success-message {
  font-size: 1.125rem; /* 18px */
  color: var(--pav-text-secondary);
}

h3 {
  margin-block-end: var(--pav-space-4);
}

</style>
