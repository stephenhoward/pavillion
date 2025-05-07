<style scoped lang="scss">
@use '../../../assets/mixins' as *;

input[type="text"],input[type="password"],textarea {
    font-size: 14pt;
    background-color: rgba(255,255,255,0.5);
    margin: 6px 0px;
    grid-column: 1 / span 2;
    border: 1px solid #ccc;
    border-radius: $form-input-border-radius;
    padding: 8px 18px;
    &:focus {
        border: 1px solid rgb(73, 111, 186);
    }
    display: block;
}

button {
    display: inline-block;
    margin-right: 10px;
}


@include dark-mode {

    input[type="text"],textarea {
        background-color: rgba(100,100,100,0.2);
        border: 1px solid #777;
        color: $dark-mode-text;
        &:focus {
            border: 1px solid #abd;
        }
    }
}

</style>

<template>
  <ModalLayout :title="t('title')" @close="$emit('close')">
    <div class="invite">
      <div class="error" v-if="state.err">{{ state.err }}</div>
      <input type="text"
             name="email"
             v-bind:placeholder="t('email_placeholder')"
             v-model="state.email"/>
      <button type="submit" class="primary" @click="sendInvite(state.email)">{{ t("invite_button") }}</button>
      <button type="button" @click="$emit('close')">{{ t("close_button") }}</button>
    </div>
  </ModalLayout>
</template>

<script setup>
import { reactive } from 'vue';
import { useTranslation } from 'i18next-vue';
import AccountInvitation from '../../../../common/model/invitation';
import { useInvitationStore } from '../../../stores/invitationStore';
import ModelService from '../../../service/models';
import ModalLayout from '../../modal.vue';

const emit = defineEmits(['close']);
const invitationStore = useInvitationStore();

const { t } = useTranslation('admin', {
  keyPrefix: 'invite_form',
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
