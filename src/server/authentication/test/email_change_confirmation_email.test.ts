import { describe, it, expect } from 'vitest';
import config from 'config';

import { Account } from '@/common/model/account';
import EmailChangeConfirmationEmail from '@/server/authentication/model/email_change_confirmation_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

describe('EmailChangeConfirmationEmail', () => {
  const expectedLink = `https://${config.get('domain')}/auth/email/confirm/confirm-token-123`;

  it('renders the absolute link in the plaintext body', () => {
    const message = new EmailChangeConfirmationEmail(new Account('account-id', 'user', 'user@example.com'), 'new@example.com', 'confirm-token-123').buildMessage('en');

    expect(message.textMessage).toContain(expectedLink);
  });

  it('renders the absolute link as the button href in the HTML body', () => {
    const message = new EmailChangeConfirmationEmail(new Account('account-id', 'user', 'user@example.com'), 'new@example.com', 'confirm-token-123').buildMessage('en');

    expect(message.htmlMessage).toContain(`href="${expectedLink}"`);
  });
});
