<template>
  <form class="welcome-card"
        @submit.prevent="startReset">
    <h3>{{ t('title') }}</h3>
    <p>{{ t('instructions') }}</p>
    <div v-if="state.error" role="alert" aria-live="polite">
      {{ state.error }}
    </div>
    <fieldset>
      <label for="reset-email" class="sr-only">{{ t('email') }}</label>
      <input type="email"
             id="reset-email"
             name="email"
             class="form-control"
             :placeholder="t('email')"
             v-model="state.email"
             required
             aria-describedby="email-help"/>
    </fieldset>

    <button type="submit">
      {{ t('go_button') }}
    </button>
    <router-link :to="{ name: 'login', query: { email: state.email }}" >
      {{ t("login_link") }}
    </router-link>
  </form>
</template>

<style lang="scss">
</style>

<script setup>
import { reactive, inject } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';

const { t } = useTranslation('authentication', {
  keyPrefix: 'forgot_password',
});
const authentication = inject('authn');

const router = useRouter();
const route = useRoute();
const state = reactive({
  error: route.query.err,
  email: route.query.email,
});

async function startReset() {

  try {

    await authentication.reset_password( state.email );

    router.push({ name:'reset_password', query: { email: state.email } });
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
