<template>
    <div v-if="state.showSuccess" class="register-apply">
        <h3>{{ t('title') }}</h3>
        <p>{{ t('application_submitted') }}</p>
        <router-link :to="{ name: 'login', params: { em: state.email}}">
            {{ t("go_login") }}
        </router-link>
    </div>
    <div v-else class="register-apply">
        <h3>{{ t('title') }}</h3>
        <div class="error" v-if="state.err">{{ state.err }}</div>
        <input type="email"    v-bind:placeholder="t('email')"    v-model="state.email">
        <label>{{  t('message_label') }}</label><textarea v-model="state.message"></textarea>
        <button class="primary" @click="doApply" type="button">{{ t("create_button") }}</button>
        <router-link :to="{ name: 'login', params: { em: state.email}}">
            {{ t("go_login") }}
        </router-link>
    </div>
</template>

<script setup>
    import { reactive, onBeforeMount, inject } from 'vue';
    import { useRouter, useRoute } from 'vue-router'
    import { useTranslation } from 'i18next-vue';

    const router = useRouter();
    const authn = inject('authn');
    const { t } = useTranslation('registration', {
        keyPrefix: 'apply'
    });

    const props = defineProps(['error', 'em']);
    const state = reactive({
        err      : '',
        email    : '',
        message  : '',
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

    async function doApply() {
        try {

            await authn.register_apply(state.email,state.message);
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

div.register-apply {
    @include auth-form;
}
@include dark-mode {
    div.register-apply {
        @include auth-form-dark-mode;
    }
}

</style>