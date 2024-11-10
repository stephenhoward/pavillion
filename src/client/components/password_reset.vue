<template>
    <div class="password_reset">
        <ol>
            <li v-if="! state.codeValidated">
                <h3>{{ t('check_email_title') }}</h3>
                <p>{{ t('check_email') }} {{ state.email }}.</p>
                <input v-model="state.reset_code" :placeholder="t('reset_code')" >
                <button @click="submitResetCode">{{ t('reset_button') }}</button>
                <router-link :to="{ name: 'login', params: { em: state.email }}" >{{ t("login_link") }}</router-link>
            </li>
            <li v-else>
                <h3>{{ t('code_validated_title') }}</h3>
                <p>{{ t('code_validated') }}</p>
                <input type="password" :placeholder="t('password_placeholder')" v-model="state.password">
                <input type="password" :placeholder="t('password2_placeholder')" v-model="state.password2" @keyup.enter="setPassword">
                <button type="button" @click="setPassword" class="icofont-arrow-right"><span class="sr-only">Next</span></button>
            </li>
        </ol>
        <div v-if="state.form_error" class="error">{{ t(state.form_error) }}</div>
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
    div.password_reset {
        @include auth-form;

        ol {
            list-style-type: none;
            margin: 0;
            padding: 0;
            li {
                margin: 0;
                padding: 0;

                & > * {
                    display: block;
                }
            }
        }
    }
}
</style>

<script setup>
    import { reactive, onBeforeMount, inject } from 'vue';
    import { useRouter } from 'vue-router'
    import { useI18n } from 'vue-i18n';

    const router = useRouter();
    const { t } = useI18n({
        messages: {
            en: {
                check_email_title: 'Password Reset Sent',
                check_email: 'We have sent a code to reset your password to',
                code_validated_title: 'Valid Code',
                code_validated: 'Please set a new password',
                login_link: 'back to sign in',
                reset_code: 'reset code',
                reset_button: 'submit code',
                password_placeholder: 'password',
                password2_placeholder: 'confirm password',

                bad_token: 'invalid or expired token',
                missing_password: 'please enter a password',
                missing_password2: 'please re-type your password to confirm',
                bad_password_match: 'Passwords do not match',
                no_token_provided: 'Must provide a password reset token',
                no_password_provided: 'Must provide a password',
                unknown_error: 'An unknown error occurred'
            }
        }
    });
    const authn = inject('authn');

    const props = defineProps(['email']);
    const state = reactive({
        reset_code: '',
        codeValidated: false,
        password:    '',
        password2:   '',
        form_error: ''
    });

    function submitResetCode() {

        state.form_error = '';
        authentication.check_password_reset_token(state.reset_code)
            .then(  () => { state.codeValidated = true } )
            .catch( () => { state.form_error = 'bad_token' } )
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
                await authentication.use_password_reset_token(state.reset_code, state.password);
                router.push('/login');
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

