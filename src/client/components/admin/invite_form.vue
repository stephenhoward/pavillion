<style scoped lang="scss">
@use '../../assets/mixins' as *;
section {
    border-top: 1px soilid $light-mode-border;
    padding: 10px;
    margin-top: 10px;
    label {
        display: block;
        margin-bottom: 10px;
    }
    input {
        -webkit-appearance: none;
        -moz-appearance: none;
        appearance: none;
        font-size: 14px;
        display: block;
        margin: 6px 0;
        border-radius: 6px;
        border: 1px solid $light-mode-border;
        padding: 6px;
        @include dark-mode {
            color: $dark-mode-input-text;
            background: $dark-mode-input-background;
            border-color: $dark-mode-border;
        }
    }
    div.schedule {
        margin-bottom: 15px;
    }
    @include dark-mode {
        border-top: 1px solid $dark-mode-border;
    }
}
section.location, section.description {
    input[type="text"] {
        width: 100%;
    }
}
section.location {
    input[type="text"] {
        max-width: 500px;
    }
}
button {
    font-size: 14px;
    border: 1px solid $light-mode-border;
    border-radius: 6px;
    padding: 6px 10px;
    margin-right: 10px;
    @include dark-mode {
        color: $dark-mode-text;
        background: $dark-mode-background;
        border-color: $dark-mode-border;
    }
    &.remove {
        font-size: 20px;
        background: none;
        border: none;
        display: block;
        float: right;
    }
    img {
        width: 16px;
    }
}

div.schedule {
    width: 100%;
}
</style>

<template>
    <modal-layout :title="t('title')" @close="$emit('close')">
    <div class="invite">
        <div class="error" v-if="state.err">{{ state.err }}</div>
        <input type="text" name="email" v-bind:placeholder="t('email_placeholder')" v-model="state.email">
        <button type="submit" @click="sendInvite(state.email)">{{ t("invite_button") }}</button>
        <button type="button" @click="$emit('close')">{{ t("close_button") }}</button>
    </div>
    </modal-layout>
</template>

<script setup>
    import { reactive } from 'vue';
    import { useTranslation } from 'i18next-vue';
    import AccountInvitation from '../../../common/model/invitation';
    import { useInvitationStore } from '../../stores/invitationStore';
    import ModelService from '../../service/models';
    import ModalLayout from '../modal.vue';

    const emit = defineEmits(['close']);
    const invitationStore = useInvitationStore();

    const { t } = useTranslation('admin', {
        keyPrefix: 'invite_form'
    });
    const state = reactive({
        email: '',
    });


    const sendInvite = async (email) => {
        const model = AccountInvitation.fromObject({
            email: email,
        });
        const invite = AccountInvitation.fromObject(await ModelService.createModel(model, '/api/accounts/v1/invitations'));
            invitationStore.addInvitation(invite);
            emit('close');
    };
</script>
