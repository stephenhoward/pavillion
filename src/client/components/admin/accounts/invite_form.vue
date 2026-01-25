<template>
  <ModalLayout :title="t('title')" @close="$emit('close')">
    <form class="invite"
          @submit.prevent="sendInvite(state.email)"
          novalidate>
      <div class="error"
           v-if="state.err"
           role="alert"
           aria-live="polite">
        <span id="invite-error">{{ state.err }}</span>
      </div>
      <fieldset>
        <legend class="sr-only">{{ t('title') }}</legend>
        <div class="form-group">
          <label for="invite-email" class="sr-only">{{ t('email_placeholder') }}</label>
          <input type="email"
                 id="invite-email"
                 name="email"
                 class="form-control"
                 :class="{ 'form-control--error': state.err }"
                 v-bind:placeholder="t('email_placeholder')"
                 v-model="state.email"
                 :aria-invalid="state.err ? 'true' : 'false'"
                 :aria-describedby="state.err ? 'invite-error' : undefined"
                 required/>
        </div>
        <div class="form-actions">
          <button type="submit"
                  class="primary"
                  :aria-describedby="state.err ? 'invite-error' : undefined">
            {{ t("invite_button") }}
          </button>
          <button type="button" @click="$emit('close')">{{ t("close_button") }}</button>
        </div>
      </fieldset>
    </form>
  </ModalLayout>
</template>

<script setup>
import { reactive } from 'vue';
import { useTranslation } from 'i18next-vue';
import axios from 'axios';
import AccountInvitation from '@/common/model/invitation';
import { useInvitationStore } from '@/client/stores/invitationStore';
import ModalLayout from '@/client/components/common/modal.vue';

const emit = defineEmits(['close']);
const invitationStore = useInvitationStore();

const { t } = useTranslation('admin', {
  keyPrefix: 'invite_form',
});
const state = reactive({
  email: '',
});

/**
 * Sends an invitation to the specified email address.
 * Posts the email to the API, which creates the full invitation
 * with the authenticated user as invitedBy, then adds the created
 * invitation to the invitationStore and closes the modal form.
 *
 * @param {string} email - The email address to send the invitation to
 * @returns {Promise<void>}
 */
const sendInvite = async (email) => {
  // Send just the email; backend will populate invitedBy and other fields
  const response = await axios.post('/api/accounts/v1/invitations', { email });
  const invite = AccountInvitation.fromObject(response.data);
  invitationStore.addInvitation(invite);
  emit('close');
};
</script>
