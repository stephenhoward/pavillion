import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import config from 'config';

import { Account } from '@/common/model/account';
import AccountAlreadyExistsEmail from '@/server/accounts/model/account_already_exists_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

describe('AccountAlreadyExistsEmail', () => {

  let sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  it('should build message with correct email address', () => {
    const account = new Account('id', 'testuser', 'user@example.com');
    const email = new AccountAlreadyExistsEmail(account);

    const message = email.buildMessage('en');

    expect(message.emailAddress).toBe('user@example.com');
  });

  it('should include login and forgot password URLs in plaintext', () => {
    const domain = config.get('domain');
    const account = new Account('id', 'testuser', 'user@example.com');
    const email = new AccountAlreadyExistsEmail(account);

    const message = email.buildMessage('en');

    expect(message.textMessage).toContain(domain + '/auth/login');
    expect(message.textMessage).toContain(domain + '/auth/forgot');
  });

  it('should include login and forgot password URLs in HTML', () => {
    const domain = config.get('domain');
    const account = new Account('id', 'testuser', 'user@example.com');
    const email = new AccountAlreadyExistsEmail(account);

    const message = email.buildMessage('en');

    expect(message.htmlMessage).toContain(domain + '/auth/login');
    expect(message.htmlMessage).toContain(domain + '/auth/forgot');
  });

  it('should have a subject line', () => {
    const account = new Account('id', 'testuser', 'user@example.com');
    const email = new AccountAlreadyExistsEmail(account);

    const message = email.buildMessage('en');

    expect(message.subject).toBeTruthy();
  });
});
