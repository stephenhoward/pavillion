import { describe, it, expect } from 'vitest';
import config from 'config';

import { Account } from '@/common/model/account';
import PasswordResetEmail from '@/server/authentication/model/password_reset_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

describe('PasswordResetEmail', () => {
  const expectedLink = `https://${config.get('domain')}/auth/password?code=reset-token-123`;

  it('renders the absolute link in the plaintext body', () => {
    const message = new PasswordResetEmail(new Account('account-id', 'user', 'user@example.com'), 'reset-token-123').buildMessage('en');

    expect(message.textMessage).toContain(expectedLink);
  });

  it('renders the absolute link as the button href in the HTML body', () => {
    const message = new PasswordResetEmail(new Account('account-id', 'user', 'user@example.com'), 'reset-token-123').buildMessage('en');

    expect(message.htmlMessage).toContain(`href="${expectedLink}"`);
  });
});
