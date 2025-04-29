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
        <router-link :to="{ name: 'login', params: { em: state.email}}" class="button">
            {{ t("go_login") }}
        </router-link>
    </div>
</template>

<script setup>
    import { reactive, onBeforeMount, inject } from 'vue';
    import { useRouter, useRoute } from 'vue-router'
    import { useI18n } from 'vue-i18n';

    const router = useRouter();
    const authn = inject('authn');
    const { t } = useI18n({
        messages: {
            en: {
                'title': 'Create an account',
                'create_button': 'Create an account',
                email: 'email',
                go_login: 'back to sign in',
                '400': 'bad sign in',
                'unknown_error': 'An unknown error occurred',
                'account_exists': 'An account already exists for this email address'
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
    const route = useRoute();

    onBeforeMount(() => {
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

body {
    div.login {
        @include auth-form;
    }
}
</style>