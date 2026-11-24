import { describe, it, expect } from 'vitest';
import config from 'config';

import { Account } from '@/common/model/account';
import AccountRegistrationEmail from '@/server/accounts/model/registration_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

describe('AccountRegistrationEmail', () => {
  const expectedLink = `https://${config.get('domain')}/auth/password?code=reg-token-123`;

  it('renders the absolute link in the plaintext body', () => {
    const message = new AccountRegistrationEmail(new Account('account-id', 'user', 'user@example.com'), 'reg-token-123', 'Riverside Events').buildMessage('en');

    expect(message.textMessage).toContain(expectedLink);
  });

  it('renders the absolute link as the button href in the HTML body', () => {
    const message = new AccountRegistrationEmail(new Account('account-id', 'user', 'user@example.com'), 'reg-token-123', 'Riverside Events').buildMessage('en');

    expect(message.htmlMessage).toContain(`href="${expectedLink}"`);
  });
});

describe('AccountRegistrationEmail sign-off', () => {
  const build = (name: string) => new AccountRegistrationEmail(new Account('id', 'user', 'user@example.com'), 'tok', name);

  it.each(['en', 'es', 'fr'])('signs off with the instance name instead of a team name (%s)', (language) => {
    const message = build('Riverside Events').buildMessage(language);

    expect(message.textMessage.trimEnd()).toMatch(/Riverside Events\s*(-{3,}[\s\S]*)?$/);
    expect(message.htmlMessage).toContain('Riverside Events');
    for (const body of [message.textMessage, message.htmlMessage]) {
      expect(body).not.toContain('Pavillion Team');
      expect(body).not.toContain('The Team');
    }
  });

  it('escapes the instance name in HTML and leaves it literal in text', () => {
    const message = build('Arts & Crafts').buildMessage('en');

    expect(message.htmlMessage).toContain('Arts &amp; Crafts');
    expect(message.textMessage).toContain('Arts & Crafts');
    expect(message.textMessage).not.toContain('&amp;');
  });
});
