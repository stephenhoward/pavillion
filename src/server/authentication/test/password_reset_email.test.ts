import { describe, it, expect } from 'vitest';
import config from 'config';

import { Account } from '@/common/model/account';
import PasswordResetEmail from '@/server/authentication/model/password_reset_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

describe('PasswordResetEmail', () => {
  const expectedLink = `https://${config.get('domain')}/auth/password?code=reset-token-123`;

  it('renders the absolute link in the plaintext body', () => {
    const message = new PasswordResetEmail(new Account('account-id', 'user', 'user@example.com'), 'reset-token-123', 'Test Instance').buildMessage('en');

    expect(message.textMessage).toContain(expectedLink);
  });

  it('renders the absolute link as the button href in the HTML body', () => {
    const message = new PasswordResetEmail(new Account('account-id', 'user', 'user@example.com'), 'reset-token-123', 'Test Instance').buildMessage('en');

    expect(message.htmlMessage).toContain(`href="${expectedLink}"`);
  });

  it('signs off with the instance name in both bodies', () => {
    const message = new PasswordResetEmail(new Account('account-id', 'user', 'user@example.com'), 'reset-token-123', 'Test Instance').buildMessage('en');

    expect(message.textMessage).toContain('Test Instance');
    expect(message.htmlMessage).toContain('Test Instance');
    expect(message.textMessage).not.toContain('Pavillion Team');
    expect(message.htmlMessage).not.toContain('Pavillion Team');
  });

  it('escapes an admin-entered instance name in the HTML body only', () => {
    const message = new PasswordResetEmail(new Account('account-id', 'user', 'user@example.com'), 'reset-token-123', 'A & <b>B</b>').buildMessage('en');

    expect(message.htmlMessage).toContain('A &amp; &lt;b&gt;B&lt;/b&gt;');
    expect(message.htmlMessage).not.toContain('<b>B</b>');
    expect(message.textMessage).toContain('A & <b>B</b>');
  });
});
