<template>
    <div class="forgot_password">
        <h3>{{ t('title') }}</h3>
        <p>{{ t('instructions') }}</p>
        <div class="error" v-if="state.error">{{ state.error }}</div>
        <input type="email" v-bind:placeholder="t('email')" v-model="state.email">
        <button v-on:click="startReset" type="button">{{ t('go_button') }}</button>
        <router-link :to="{ name: 'login', query: { email: state.email }}" >{{ t("login_link") }}</router-link>
    </div>
</template>

<style lang="scss">
@import '../assets/mixins.scss';

body {
    display:               grid;

    grid-template-columns: [ begin ] auto [ end ];
    grid-template-rows:    [ top ] auto [ bottom ];
    justify-items: center;
    align-items: center;
    div.forgot_password {
        @include auth-form;
    }
}
</style>

<script setup>
    import { reactive, inject } from 'vue';
    import { useRouter, useRoute } from 'vue-router'
    import { useI18n } from 'vue-i18n';

    const { t } = useI18n({
        messages: {
            en: {
                title: 'Forgot your password?',
                instructions: 'No problem. Enter your email address and we will email you a password reset link.',
                email: 'your email address',
                go_button: 'send password reset',
                login_link: 'back to sign in',
                error_400: 'There is a problem with the email you submitted',
                error_404: 'We could not find an account with that email address',
                error_500: 'Oops. The server ran into an error. Please contact support',
                no_email_provided: 'Please enter your email address'

            }
        }
    });
    const authentication = inject('authn');

    const router = useRouter();
    const route = useRoute();
    const state = reactive({
        error: route.query.err,
        email: route.query.email
    })

    async function startReset() {

        try {

            await authentication.reset_password( state.email )

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