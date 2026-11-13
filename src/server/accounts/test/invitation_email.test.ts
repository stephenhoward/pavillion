import { describe, it, expect } from 'vitest';
import config from 'config';

import { Account } from '@/common/model/account';
import AccountInvitation from '@/common/model/invitation';
import AccountInvitationEmail from '@/server/accounts/model/invitation_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

const buildEmail = (context = { instanceName: 'Riverside Events', inviterName: 'Dana Organizer' }, message?: string) =>
  new AccountInvitationEmail(
    new AccountInvitation('invite-id', 'invitee@example.com', new Account('inviter-id', 'inviter', 'inviter@example.com'), message),
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

  it.each([
    ['en', 'Personal message from inviter: Welcome aboard'],
    ['es', 'Mensaje personal de quien te invita: Welcome aboard'],
    ['fr', 'Message personnel de l\'invitant'],
  ])('renders the inviter message in text and HTML (%s)', (language, expected) => {
    const message = buildEmail(undefined, 'Welcome aboard').buildMessage(language);

    expect(message.textMessage).toContain(expected);
    expect(message.htmlMessage).toContain(expected.replace('\'', '&#x27;'));
    expect(message.textMessage).toContain('Welcome aboard');
  });

  it('escapes the inviter message in HTML but not in plain text', () => {
    const message = buildEmail(undefined, '<b>hi</b> & bye').buildMessage('en');

    expect(message.htmlMessage).not.toContain('<b>hi</b>');
    expect(message.htmlMessage).toContain('&lt;b&gt;hi&lt;/b&gt;');
    expect(message.textMessage).toContain('<b>hi</b> & bye');
  });

  it('omits the personal message when none was written', () => {
    const message = buildEmail().buildMessage('en');

    expect(message.textMessage).not.toContain('Personal message');
    expect(message.htmlMessage).not.toContain('Personal message');
  });
});
