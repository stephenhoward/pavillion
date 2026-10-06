import { describe, it, expect } from 'vitest';
import config from 'config';

import { Account } from '@/common/model/account';
import AccountInvitation from '@/common/model/invitation';
import AccountInvitationEmail from '@/server/accounts/model/invitation_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

describe('AccountInvitationEmail', () => {
  const expectedLink = `https://${config.get('domain')}/auth/invitation?code=invite-code-123`;

  it('renders the absolute link in the plaintext body', () => {
    const message = new AccountInvitationEmail(new AccountInvitation('invite-id', 'invitee@example.com', new Account('inviter-id', 'inviter', 'inviter@example.com')), 'invite-code-123').buildMessage('en');

    expect(message.textMessage).toContain(expectedLink);
  });

  it('renders the absolute link as the button href in the HTML body', () => {
    const message = new AccountInvitationEmail(new AccountInvitation('invite-id', 'invitee@example.com', new Account('inviter-id', 'inviter', 'inviter@example.com')), 'invite-code-123').buildMessage('en');

    expect(message.htmlMessage).toContain(`href="${expectedLink}"`);
  });
});
