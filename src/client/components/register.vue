<template>
    <div v-if="state.showSuccess" class="login">
        <h3>{{ t('title') }}</h3>
        Check your email "{{ state.email }}" for a confirmation link
    </div>
    <div v-else class="login">
        <h3>{{ t('title') }}</h3>
        <div class="error" v-if="state.err">{{ state.err }}</div>
        <input type="email"    v-bind:placeholder="t('email')"    v-model="state.email">
        <button @click="doRegister" type="button">{{ t("create_button") }}</button>
    </div>
</template>

<script setup>
    import { reactive, onBeforeMount, inject } from 'vue';
    import { useRouter } from 'vue-router'
    import { useI18n } from 'vue-i18n';

    const router = useRouter();
    const authn = inject('authn');
    const { t } = useI18n({
        messages: {
            en: {
                'title': 'Create an account',
                'create_button': 'Create an account',
                email: 'email',
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
        showSuccess: false
    });

    onBeforeMount(() => {
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