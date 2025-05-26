import { Account } from '@/common/model/account';

export interface AccountCreatedPayload {
  account: Account;
}

export interface AccountApplicationAcceptedPayload {
  account: Account;
  applicationId: string;
}

export interface AccountInvitationSentPayload {
  invitation: any; // Use proper type when available
}
