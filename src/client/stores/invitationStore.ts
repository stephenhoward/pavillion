import { defineStore } from 'pinia';
import AccountInvitation from '@/common/model/invitation';

export const useInvitationStore = defineStore('invitations', {
  state: () => {
    return {
      invitations: [] as AccountInvitation[],
    };
  },
  actions: {
    /**
     * Adds a new account invitation to the store.
     *
     * @param {AccountInvitation} invitation - The account invitation to add to the store
     */
    addInvitation(invitation: AccountInvitation) {
      this.invitations.push(invitation);
    },

    /**
     * Updates an existing account invitation in the store or adds it if not found.
     *
     * @param {AccountInvitation} invitation - The account invitation to update or add
     */
    updateInvitation(invitation: AccountInvitation) {
      const index = this.invitations.findIndex((e: AccountInvitation ) => e.id === invitation.id );
      if ( index >= 0 ) {
        this.invitations[index] = invitation;
      }
      else {
        this.addInvitation(invitation);
      }
    },

    /**
     * Removes an account invitation from the store.
     *
     * @param {AccountInvitation} invitation - The account invitation to remove
     */
    removeInvitation(invitation: AccountInvitation) {
      const index = this.invitations.findIndex((e: AccountInvitation ) => e.id === invitation.id );
      if (index >= 0) {
        this.invitations.splice(index, 1);
      }
    },
  },
});
