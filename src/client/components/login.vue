<template>
    <div class="login">
        <h3>{{ t('title') }}</h3>
        <div class="error" v-if="state.err">{{ state.err }}</div>
        <input type="email"    v-bind:placeholder="t('email')"    v-model="state.email">
        <input type="password" v-bind:placeholder="t('password')" v-model="state.password" @keyup.enter="doLogin">
        <router-link :to="{ name: 'forgot_password', params: { em: state.email }}" >{{ t("forgot_password") }}</router-link>
        <button @click="doLogin" type="button">{{ t("login_button") }}</button>
        <router-link v-if="state.registrationMode == 'open'" :to="{ name: 'register', params: { em: state.email}}" class="button">
            {{ t("register_button") }}
        </router-link>
        <router-link v-if="state.registrationMode == 'apply'" :to="{ name: 'register-apply', params: { em: state.email}}" class="button">
            {{ t("register_button") }}
        </router-link>
    </div>
</template>

<script setup>
    import { reactive, onBeforeMount, inject } from 'vue';
    import { useRouter } from 'vue-router'
    import { useI18n } from 'vue-i18n';

    const router = useRouter();
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
                '400': 'bad sign in',
                'unknown_error': 'An unknown error occurred'
            }

        }
    });

    const props = defineProps(['error', 'em']);
    const state = reactive({
        err      : '',
        email    : '',
        password : '',
        registrationMode : site_config.settings.registrationMode
    });

    onBeforeMount(() => {
        state.err   = state.error || '';
        state.email = state.em || '';
    });

    async function doLogin() {
        try {

            if ( await authn.login(state.email,state.password) ) {
                console.log("login success");
                state.err = '';
                router.push('/manage');
            }
            else {
                console.log("login failed");
                state.err = t('400');
            }
        }
        catch(error) {

            console.log("catch error from login");
            console.log(error);
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
@import '../assets/mixins.scss';

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