<template>
  <section>
    <div v-if="state.resendSuccess" class="success-message">
      {{ t('resend_success', { email: state.resendSuccess }) }}
    </div>
    <div v-if="state.resendError" class="error-message">
      {{ t('resend_error', { email: state.resendError }) }}
    </div>
    <div v-if="store.invitations && store.invitations.length > 0">
      <h3>{{ t('title') }}</h3>
      <button type="button" @click="state.addInvite=true">{{ t('invite_new_account') }}</button>
      <table>
        <thead>
          <tr>
            <th scope="col">{{ t('email_column') }}</th>
            <th scope="col">{{ t('expires_column') }}</th>
            <th scope="col">{{ t('actions_column') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="invitation in store.invitations">
            <td>{{ invitation.email }}</td>
            <td :class="{ 'expired': isExpired(invitation.expirationTime) }">
              {{ formatExpirationTime(invitation.expirationTime) }}
            </td>
            <td>
              <button type="button" @click="resendInvitation(invitation)" :disabled="state.resending === invitation.id">
                <span v-if="state.resending === invitation.id">{{ t('sending') }}</span>
                <span v-else>{{ t('resend') }}</span>
              </button>
              <button type="button" @click="cancelInvitation(invitation)">{{ t('cancel') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <EmptyLayout v-else :title="t('noInvitations')" :description="t('noInvitationsDescription')">
      <button type="button" class="primary" @click="state.addInvite=true">
        {{ t('invite_new_account') }}
      </button>
    </EmptyLayout>
    <div v-if="state.addInvite">
      <InviteFormView @close="state.addInvite=false" />
    </div>
  </section>
</template>

<script setup>
import { onBeforeMount, reactive, inject } from 'vue';
import { DateTime } from 'luxon';
import { useTranslation } from 'i18next-vue';
import ModelService from '@/client/service/models';
import { useInvitationStore } from '@/client/stores/invitationStore';
import AccountInvitation from '@/common/model/invitation';
import InviteFormView from './invite_form.vue';
import EmptyLayout from '@/client/components/common/empty_state.vue';

const store = useInvitationStore();
const authn = inject('authn');
const { t } = useTranslation('admin', {
  keyPrefix: 'invitations',
});

onBeforeMount(async () => {
  let invitations = await ModelService.listModels('/api/accounts/v1/invitations');
  store.invitations = invitations.map(invitation => AccountInvitation.fromObject(invitation));
});
const state = reactive({
  addInvite: false,
  resending: null,
  resendSuccess: null,
  resendError: null,
});

const formatExpirationTime = (expTime) => {
  if (!expTime) return t('unknown_expiration');

  const expirationDateTime = DateTime.fromJSDate(new Date(expTime));
  const now = DateTime.now();

  return expirationDateTime < now ? t('expired') : expirationDateTime.toLocaleString(DateTime.DATETIME_SHORT);
};

const isExpired = (expTime) => {
  if (!expTime) return true;

  const expirationDateTime = DateTime.fromJSDate(new Date(expTime));
  const now = DateTime.now();

  return expirationDateTime < now;
};

const cancelInvitation = async (invitation) => {
  try {
    await ModelService.deleteModel(invitation, '/api/accounts/v1/invitations');
    store.removeInvitation(invitation);
  }
  catch (error) {
    console.error('Error deleting invitation:', error);
  }
};

const resendInvitation = async (invitation) => {
  try {
    state.resending = invitation.id;
    state.resendError = null;
    state.resendSuccess = null;

    const updatedInvitation = await authn.resendInvitation(invitation.id);
    store.updateInvitation(AccountInvitation.fromObject(updatedInvitation));

    state.resendSuccess = invitation.email;
    setTimeout(() => {
      state.resendSuccess = null;
    }, 3000);
  }
  catch (error) {
    console.error('Error resending invitation:', error);
    state.resendError = invitation.email;
    setTimeout(() => {
      state.resendError = null;
    }, 3000);
  }
  finally {
    state.resending = null;
  }
};
</script>

<style scoped lang="scss">
@use '../../../assets/mixins' as *;

.expired {
  color: red;
}
.success-message {
  color: green;
  padding: 10px;
  margin-bottom: 10px;
  background-color: #e8f5e9;
  border: 1px solid green;
  border-radius: 4px;
}
.error-message {
  color: red;
  padding: 10px;
  margin-bottom: 10px;
  background-color: #ffebee;
  border: 1px solid red;
  border-radius: 4px;
}
button {
  margin-right: 5px;
}


</style>
