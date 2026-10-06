import { describe, it, expect } from 'vitest';
import config from 'config';

import { Account } from '@/common/model/account';
import AccountRegistrationEmail from '@/server/accounts/model/registration_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

describe('AccountRegistrationEmail', () => {
  const expectedLink = `https://${config.get('domain')}/auth/password?code=reg-token-123`;

  it('renders the absolute link in the plaintext body', () => {
    const message = new AccountRegistrationEmail(new Account('account-id', 'user', 'user@example.com'), 'reg-token-123').buildMessage('en');

    expect(message.textMessage).toContain(expectedLink);
  });

  it('renders the absolute link as the button href in the HTML body', () => {
    const message = new AccountRegistrationEmail(new Account('account-id', 'user', 'user@example.com'), 'reg-token-123').buildMessage('en');

    expect(message.htmlMessage).toContain(`href="${expectedLink}"`);
  });
});
