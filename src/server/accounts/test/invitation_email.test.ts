import { describe, it, expect } from 'vitest';
import config from 'config';

import { Account } from '@/common/model/account';
import AccountInvitation from '@/common/model/invitation';
import AccountInvitationEmail from '@/server/accounts/model/invitation_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

const buildEmail = (context = { instanceName: 'Riverside Events', inviterName: 'Dana Organizer' }) =>
  new AccountInvitationEmail(
    new AccountInvitation('invite-id', 'invitee@example.com', new Account('inviter-id', 'inviter', 'inviter@example.com')),
    'invite-code-123',
    context,
  );

describe('AccountInvitationEmail', () => {
  const expectedLink = `https://${config.get('domain')}/auth/invitation?code=invite-code-123`;

  it('renders the absolute link in the plaintext body', () => {
    expect(buildEmail().buildMessage('en').textMessage).toContain(expectedLink);
  });

  it('renders the absolute link as the button href in the HTML body', () => {
    expect(buildEmail().buildMessage('en').htmlMessage).toContain(`href="${expectedLink}"`);
  });

  it.each(['en', 'es', 'fr'])('names the instance and inviter and shows no raw key (%s)', (language) => {
    const message = buildEmail().buildMessage(language);

    expect(message.subject).toContain('Riverside Events');
    expect(message.subject).not.toContain('Pavillion');
    for (const body of [message.textMessage, message.htmlMessage]) {
      expect(body).toContain('Riverside Events');
      expect(body).toContain('Dana Organizer');
      expect(body).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
      expect(body).not.toContain('Pavillion');
    }
  });

  it('does not HTML-escape the plain-text part', () => {
    const message = buildEmail({ instanceName: 'Stephen\'s Arts & Crafts', inviterName: 'Dana' }).buildMessage('en');

    expect(message.textMessage).toContain('Stephen\'s Arts & Crafts');
    expect(message.textMessage).not.toContain('&#');
    expect(message.textMessage).not.toContain('&amp;');
  });

  it.each(['en', 'es', 'fr'])('uses the no-inviter sentence when the inviter is unknown (%s)', (language) => {
    const message = buildEmail({ instanceName: 'Riverside Events', inviterName: '' }).buildMessage(language);

    expect(message.textMessage).toContain('Riverside Events');
    expect(message.textMessage).not.toMatch(/\n\s+(has invited|te ha invitado|vous a invité)/);
    expect(message.textMessage).not.toContain('undefined');
  });
});
