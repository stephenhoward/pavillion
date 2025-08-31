<template>
  <div v-if="state.showSuccess" class="welcome-card">
    <h3>{{ t('title') }}</h3>
    <p>{{ t('application_submitted') }}</p>
    <router-link class="primary"
                 :to="{ name: 'login', params: { em: state.email}}"
                 role="button">
      {{ t("go_login") }}
    </router-link>
  </div>
  <form v-else
        class="welcome-card"
        @submit.prevent="doApply"
        novalidate>
    <h3>{{ t('title') }}</h3>
    <div class="alert alert--error alert--sm"
         v-if="state.err"
         role="alert"
         aria-live="polite"
         :aria-describedby="state.err ? 'apply-error' : undefined">
      <span id="apply-error">{{ state.err }}</span>
    </div>
    <fieldset class="form-stack">
      <legend class="sr-only">{{ t('title') }}</legend>
      <label for="apply-email" class="sr-only">{{ t('email') }}</label>
      <input type="email"
             id="apply-email"
             class="form-control"
             :class="{ 'form-control--error': state.err }"
             v-bind:placeholder="t('email')"
             v-model="state.email"
             :aria-invalid="state.err ? 'true' : 'false'"
             :aria-describedby="state.err ? 'apply-error' : undefined"
             required/>
      <label for="apply-message">{{ t('message_label') }}</label>
      <textarea id="apply-message"
                class="textarea"
                :class="{ 'form-control--error': state.err }"
                v-model="state.message"
                :aria-invalid="state.err ? 'true' : 'false'"
                :aria-describedby="state.err ? 'apply-error' : undefined"
                rows="4"
                required/>
      <button class="primary"
              type="submit"
              :aria-describedby="state.err ? 'apply-error' : undefined">
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
