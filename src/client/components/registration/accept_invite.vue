<template>
  <div v-if="! state.codeValidated" class="accept_invite">
    <h3>{{ t('bad_invite_title') }}</h3>
    <p>{{ t('bad_invite_explanation') }}</p>
    <router-link :to="{ name: 'login', params: { em: state.email}}" class="button">
      {{ t("go_login") }}
    </router-link>
  </div>
  <div v-else class="accept_invite">
    <h3>{{ t('new_account_password_title') }}</h3>
    <p>{{ t('registration_new_password') }}</p>
    <input type="password" :placeholder="t('password_placeholder')" v-model="state.password"/>
    <input type="password"
           :placeholder="t('password2_placeholder')"
           v-model="state.password2"
           @keyup.enter="setPassword"/>
    <button type="button" @click="setPassword" class="primary icofont-arrow-right"><span class="sr-only">Next</span></button>
    <div v-if="state.form_error" class="error">{{ t(state.form_error) }}</div>
  </div>
</template>

<style lang="scss">
@use '../../assets/mixins' as *;

div.accept_invite {
    @include auth-form;
}
@include dark-mode {
    div.accept_invite {
        @include auth-form-dark-mode;
    }
}

</style>

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
  password:    '',
  password2:   '',
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
    console.log(response);
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
  }
  else if ( ! state.password2.length ) {
    state.form_error = 'missing_password2';
  }
  else if ( state.password != state.password2 ) {
    state.form_error = 'bad_password_match';
  }
  else {
    state.form_error = '';
    try {
      await authn.accept_invitation(state.invite_code, state.password);
      router.push('/auth/login');
    }
    catch (error) {
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

      state.form_error = t( error_text ) || error_text;
    }
  }
}
</script>
