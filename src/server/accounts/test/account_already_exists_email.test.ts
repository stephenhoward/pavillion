import { describe, it, expect, afterEach } from 'vitest';
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
    const email = new AccountAlreadyExistsEmail(account, 'Riverside Events');

    const message = email.buildMessage('en');

    expect(message.emailAddress).toBe('user@example.com');
  });

  it('should include login and forgot password URLs in plaintext', () => {
    const domain = config.get('domain');
    const account = new Account('id', 'testuser', 'user@example.com');
    const email = new AccountAlreadyExistsEmail(account, 'Riverside Events');

    const message = email.buildMessage('en');

    expect(message.textMessage).toContain('https://' + domain + '/auth/login');
    expect(message.textMessage).toContain('https://' + domain + '/auth/forgot');
  });

  it('should include login and forgot password URLs in HTML', () => {
    const domain = config.get('domain');
    const account = new Account('id', 'testuser', 'user@example.com');
    const email = new AccountAlreadyExistsEmail(account, 'Riverside Events');

    const message = email.buildMessage('en');

    expect(message.htmlMessage).toContain('https://' + domain + '/auth/login');
    expect(message.htmlMessage).toContain('https://' + domain + '/auth/forgot');
  });

  it('should have a subject line', () => {
    const account = new Account('id', 'testuser', 'user@example.com');
    const email = new AccountAlreadyExistsEmail(account, 'Riverside Events');

    const message = email.buildMessage('en');

    expect(message.subject).toBeTruthy();
  });
});

describe('AccountAlreadyExistsEmail sign-off', () => {
  const build = (name: string) => new AccountAlreadyExistsEmail(new Account('id', 'testuser', 'user@example.com'), name);

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
