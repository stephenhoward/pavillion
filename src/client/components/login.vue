<template>
    <div class="login">
        <h3>{{ t('title') }}</h3>
        <div class="error" v-if="state.err">{{ state.err }}</div>
        <input type="email"    v-bind:placeholder="t('email')"    v-model="state.email">
        <input type="password" v-bind:placeholder="t('password')" v-model="state.password" @keyup.enter="doLogin">
        <button type="submit" @click="doLogin">{{ t("login_button") }}</button>
        <router-link id="register" v-if="state.registrationMode == 'open'" :to="{ name: 'register', query: { email: state.email}}" class="button">
            {{ t("register_button") }}
        </router-link>
        <router-link id="apply" v-if="state.registrationMode == 'apply'" :to="{ name: 'register-apply', query: { email: state.email}}" class="button">
            {{ t("register_button") }}
        </router-link>
        <router-link :to="{ name: 'forgot_password', query: { email: state.email }}" >{{ t("forgot_password") }}</router-link>
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
        registrationMode : site_config.settings().registrationMode
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

div.login {
    background-color: rgba(0,0,0,0.2);
    display: grid;
    border-radius: 8px;
    grid-template-columns: 1fr 1fr;
    margin: 20px;
    padding: 20px;
    max-width: 400px;
    font-size: 14pt;

    a {
        display: block;
        color: $light-mode-text;
        grid-column-end: 3;
    }

        input[type="email"], input[type="password"] {
            font-size: 14pt;
            margin: 4px 0px;
            grid-column: 1 / span 2;
        }
        h3 {
            grid-column: 1 / span 2;
        }
    button, a.button {
        font-size: 14pt;
        margin: 4px 0px;
        background: $light-mode-button-background;
        background: $light-mode-button-gradient;
        border: 0;
        text-align: center;
        text-decoration: none;
        padding: 4px 8px;
        border-radius: 4px;
        grid-column-start: 1;
        grid-column-end: 3;
    }
}
@include dark-mode {
    div.login {
        background-color: rgba(255,255,255,0.2);
        a {
        color: $dark-mode-text;
    }
        button, a.button {
            background: $dark-mode-button-background;
            background: $dark-mode-button-gradient;
            padding: 4px 8px;
            color: $dark-mode-text;
        }
    }
}

</style>