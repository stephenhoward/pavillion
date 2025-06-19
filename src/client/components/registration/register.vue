<template>
  <div v-if="state.showSuccess" class="login">
    <h3>{{ t('title') }}</h3>
    Check your email "{{ state.email }}" for a confirmation link
  </div>
  <div v-else class="login">
    <h3>{{ t('title') }}</h3>
    <div class="error" v-if="state.err">{{ state.err }}</div>
    <input type="email"    v-bind:placeholder="t('email')"    v-model="state.email"/>
    <button class="primary" @click="doRegister" type="button">{{ t("create_button") }}</button>
    <router-link :to="{ name: 'login', params: { em: state.email}}" class="button">
      {{ t("go_login") }}
    </router-link>
  </div>
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
  try {

    await authn.register(state.email);
    state.err = '';
    state.showSuccess = true;
  }
  catch(error) {
    console.log(error);

    let error_text = "unknown_error";

    if ( typeof error  == "object" && "response" in error ) {
      if ( "data" in error.response ) {
        error_text = error.response.data.message;
      }
      else {
        error_text = error.message;
      }
    }
    else if ( typeof error == "string" ) {
      error_text = error;
    }
    else {
      console.log(error);
    }

    state.err = t( error_text ) || error_text;
  }
}
</script>

<style scoped lang="scss">
@use '../../assets/mixins' as *;

div.login {
    @include auth-form;
}
@include dark-mode {
    div.login {
        @include auth-form-dark-mode;
    }
}

</style>
