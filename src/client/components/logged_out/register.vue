<template>
  <div v-if="state.showSuccess" class="welcome-card">
    <h3>{{ t('title') }}</h3>
    <p>Check your email "{{ state.email }}" for a confirmation link</p>
  </div>
  <form v-else
        class="welcome-card"
        @submit.prevent="doRegister"
        novalidate>
    <h3>{{ t('title') }}</h3>
    <div class="alert alert--error alert--sm"
         v-if="state.err"
         role="alert"
         aria-live="polite"
         :aria-describedby="state.err ? 'register-error' : undefined">
      <span id="register-error">{{ state.err }}</span>
    </div>
    <fieldset class="form-stack">
      <legend class="sr-only">{{ t('title') }}</legend>
      <label for="register-email" class="sr-only">{{ t('email') }}</label>
      <input type="email"
             id="register-email"
             class="form-control"
             :class="{ 'form-control--error': state.err }"
             v-bind:placeholder="t('email')"
             v-model="state.email"
             :aria-invalid="state.err ? 'true' : 'false'"
             :aria-describedby="state.err ? 'register-error' : undefined"
             required/>
      <button class="primary"
              type="submit"
              :aria-describedby="state.err ? 'register-error' : undefined">
        {{ t("create_button") }}
      </button>
    </fieldset>
    <router-link class="forgot"
                 :to="{ name: 'login', params: { em: state.email}}">
      {{ t("go_login") }}
    </router-link>
  </form>
</template>

<script setup>
import { reactive, onBeforeMount, inject } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';

const site_config = inject('site_config');
const router = useRouter();
const authn = inject('authn');
const { t } = useTranslation('registration', {
  keyPrefix: 'register',
});

const props = defineProps(['error', 'em']);
const state = reactive({
  err      : '',
  email    : '',
  password : '',
  showSuccess: false,
});
const route = useRoute();

onBeforeMount(() => {
  if ( site_config.settings().registrationMode == 'apply' ) {
    router.push({ name: 'register-apply', query: { email: route.query.email }});
  }
  else if ( site_config.settings().registrationMode == 'closed' || site_config.settings().registrationMode == 'invitation' ) {
    router.push({ name: 'login', query: { em: route.query.email }});
  }

  if ( route.query.code ) {
    router.push({ name: 'reset_password', query: { code: route.query.code }});
  }

  state.err   = state.error || '';
  state.email = state.em || '';
});

async function doRegister() {
  if ( state.email == '' ) {
    state.err = t('MissingEmail');
    return;
  }
  try {

    await authn.register(state.email);
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


