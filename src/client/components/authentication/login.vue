<template>
  <div class="login">
    <h3>{{ t('title') }}</h3>
    <div class="error" v-if="state.err">{{ state.err }}</div>
    <input type="email"    v-bind:placeholder="t('email')"    v-model="state.email"/>
    <input type="password"
           v-bind:placeholder="t('password')"
           v-model="state.password"
           @keyup.enter="doLogin"/>
    <button class="primary" type="submit" @click="doLogin">{{ t("login_button") }}</button>
    <router-link id="register"
                 v-if="state.registrationMode == 'open'"
                 :to="{ name: 'register', query: { email: state.email}}"
                 class="button">
      {{ t("register_button") }}
    </router-link>
    <router-link id="apply"
                 v-if="state.registrationMode == 'apply'"
                 :to="{ name: 'register-apply', query: { email: state.email}}"
                 class="button">
      {{ t("apply_button") }}
    </router-link>
    <router-link class="forgot" :to="{ name: 'forgot_password', query: { email: state.email }}" >{{ t("forgot_password") }}</router-link>
  </div>
</template>

<script setup>
import { reactive, inject } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';

const router = useRouter();
const route = useRoute();
const authn = inject('authn');
const site_config = inject('site_config');
const { t } = useTranslation('authentication', {
  keyPrefix: 'login',
});

const state = reactive({
  err      : '',
  email    : route.query.email || '',
  password : '',
  registrationMode : site_config.settings().registrationMode,
});

async function doLogin() {
  if ( state.email == '' || state.password == '' ) {
    state.err = t('MissingLogin');
    return;
  }
  try {

    if ( await authn.login(state.email,state.password) ) {
      state.err = '';
      router.push('/calendar');
    }
    else {
      state.err = t('400');
    }
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
