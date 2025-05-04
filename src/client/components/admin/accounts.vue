<script setup>
  import { onBeforeMount, reactive } from 'vue';
  import { DateTime } from 'luxon';
  import ModelService from '../../service/models';
  import AccountInvitation from '../../../common/model/invitation';
  import { useInvitationStore } from '../../stores/invitationStore';
  import InviteFormView from './invite_form.vue';

  const store = useInvitationStore();

  onBeforeMount(async () => {
    let invitations = await ModelService.listModels('/api/accounts/v1/invitations');
    store.invitations = invitations.map(invitation => AccountInvitation.fromObject(invitation)); 
  });
  const state = reactive({
    addInvite: false,
  });
  
  const formatExpirationTime = (expTime) => {
    if (!expTime) return 'Unknown';
    
    const expirationDateTime = DateTime.fromJSDate(new Date(expTime));
    const now = DateTime.now();
    
    return expirationDateTime < now ? 'Expired' : expirationDateTime.toLocaleString(DateTime.DATETIME_SHORT);
  };

  const cancelInvitation = async (invitation) => {
    try {
      await ModelService.deleteModel(invitation, '/api/accounts/v1/invitations');
      store.removeInvitation(invitation);
    } catch (error) {
      console.error('Error deleting invitation:', error);
    }
  };
</script>

<template>
    <div>
      <h3>Account Applications</h3>
    <h3>Account Invitations</h3>
    <button type-="button" @click="state.addInvite=true">Invite New Account</button>
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
            <td>{{ formatExpirationTime(invitation.expirationTime) }}</td>
            <td>
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
</style>