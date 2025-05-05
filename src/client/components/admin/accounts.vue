<script setup>
  import { onBeforeMount, reactive, inject } from 'vue';
  import { DateTime } from 'luxon';
  import ModelService from '../../service/models';
  import AccountInvitation from '../../../common/model/invitation';
  import { useInvitationStore } from '../../stores/invitationStore';
  import InviteFormView from './invite_form.vue';

  const store = useInvitationStore();
  const authn = inject('authn');

  onBeforeMount(async () => {
    let invitations = await ModelService.listModels('/api/accounts/v1/invitations');
    store.invitations = invitations.map(invitation => AccountInvitation.fromObject(invitation)); 
  });
  const state = reactive({
    addInvite: false,
    resending: null,
    resendSuccess: null,
    resendError: null
  });
  
  const formatExpirationTime = (expTime) => {
    if (!expTime) return 'Unknown';
    
    const expirationDateTime = DateTime.fromJSDate(new Date(expTime));
    const now = DateTime.now();
    
    return expirationDateTime < now ? 'Expired' : expirationDateTime.toLocaleString(DateTime.DATETIME_SHORT);
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
    } catch (error) {
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
    } catch (error) {
      console.error('Error resending invitation:', error);
      state.resendError = invitation.email;
      setTimeout(() => {
        state.resendError = null;
      }, 3000);
    } finally {
      state.resending = null;
    }
  };
</script>

<template>
    <div>
      <h3>Account Applications</h3>
    <h3>Account Invitations</h3>
    <div v-if="state.resendSuccess" class="success-message">
      Successfully resent invitation to {{ state.resendSuccess }}
    </div>
    <div v-if="state.resendError" class="error-message">
      Failed to resend invitation to {{ state.resendError }}
    </div>
    <button type="button" @click="state.addInvite=true">Invite New Account</button>
    <table>
        <thead>
            <tr>
            <th scope="col">Email</th>
            <th scope="col">Expires At</th>
            <th scope="col">Actions</th>
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
                  <span v-if="state.resending === invitation.id">Sending...</span>
                  <span v-else>Resend</span>
                </button>
                <button type="button" @click="cancelInvitation(invitation)">Cancel</button>
            </td>
            </tr>
        </tbody>
    </table>
    <div v-if="state.addInvite">
    <invite-form-view @close="state.addInvite=false" />
    </div>
    <h3>Accounts</h3>
    </div>
</template>

<style scoped lang="scss">
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