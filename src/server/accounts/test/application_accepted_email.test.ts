import { describe, it, expect } from 'vitest';
import config from 'config';

import { Account } from '@/common/model/account';
import ApplicationAcceptedEmail from '@/server/accounts/model/application_accepted_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

describe('ApplicationAcceptedEmail', () => {
  const expectedLink = `https://${config.get('domain')}/auth/password?code=reset-code-123`;

  it('renders the absolute link in the plaintext body', () => {
    const message = new ApplicationAcceptedEmail(new Account('account-id', 'user', 'user@example.com'), 'reset-code-123').buildMessage('en');

    expect(message.textMessage).toContain(expectedLink);
  });

  it('renders the absolute link as the button href in the HTML body', () => {
    const message = new ApplicationAcceptedEmail(new Account('account-id', 'user', 'user@example.com'), 'reset-code-123').buildMessage('en');

    expect(message.htmlMessage).toContain(`href="${expectedLink}"`);
  });
});
