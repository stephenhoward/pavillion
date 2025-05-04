import { defineStore } from 'pinia'
import AccountInvitation from '@/common/model/invitation';

export const useInvitationStore = defineStore('invitations', {
    state: () => {
        return {
            invitations: [] as AccountInvitation[]
        }
    },
    actions: {
        addInvitation(invitation: AccountInvitation) {
            this.invitations.push(invitation);
        },
        
        updateInvitation(invitation: AccountInvitation) {
            const index = this.invitations.findIndex((e: AccountInvitation ) => e.id === invitation.id );
            if ( index >= 0 ) {
                this.invitations[index] = invitation;
            }
            else {
                this.addInvitation(invitation);
            }
        },
        
        removeInvitation(invitation: AccountInvitation) {
            const index = this.invitations.findIndex((e: AccountInvitation ) => e.id === invitation.id );
            if (index >= 0) {
                this.invitations.splice(index, 1);
            }
        }
    }
});
