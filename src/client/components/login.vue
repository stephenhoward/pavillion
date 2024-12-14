<template>
    <div class="login">
        <h3>{{ t('title') }}</h3>
        <div class="error" v-if="state.err">{{ state.err }}</div>
        <input type="email"    v-bind:placeholder="t('email')"    v-model="state.email">
        <input type="password" v-bind:placeholder="t('password')" v-model="state.password" @keyup.enter="doLogin">
        <router-link :to="{ name: 'forgot_password', query: { email: state.email }}" >{{ t("forgot_password") }}</router-link>
        <button type="submit" @click="doLogin">{{ t("login_button") }}</button>
        <router-link id="register" v-if="state.registrationMode == 'open'" :to="{ name: 'register', query: { email: state.email}}" class="button">
            {{ t("register_button") }}
        </router-link>
        <router-link id="apply" v-if="state.registrationMode == 'apply'" :to="{ name: 'register-apply', query: { email: state.email}}" class="button">
            {{ t("register_button") }}
        </router-link>
    </div>
</template>

<script setup>
    import { reactive, inject } from 'vue';
    import { useRouter, useRoute } from 'vue-router'
    import { useI18n } from 'vue-i18n';

    const router = useRouter();
    const route = useRoute();
    const authn = inject('authn');
    const site_config = inject('site_config');
    const { t } = useI18n({
        messages: {
            en: {
                'title': 'Sign in to your account',
                'login_button': 'Sign in',
                email: 'email',
                password: 'password',
                forgot_password: 'Forgot Password?',
                register_button: 'Create an Account',
                UnknownLogin: 'unknown email or password',
                MissingLogin: 'missing email or password',
                '400': 'bad sign in',
                'unknown_error': 'An unknown error occurred'
            }

        }
    });

    const state = reactive({
        err      : '',
        email    : route.query.email || '',
        password : '',
        registrationMode : site_config.settings.registrationMode
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

            state.err = t( error_text ) || error_text;
        }
    }
</script>

<style scoped lang="scss">
@use '../assets/mixins' as *;

body {
    display:               grid;

    grid-template-columns: [ begin ] auto [ end ];
    grid-template-rows:    [ top ] auto [ bottom ];
    justify-items: center;
    align-items: center;
    div.login {
        @include auth-form;
    }
}
</style>