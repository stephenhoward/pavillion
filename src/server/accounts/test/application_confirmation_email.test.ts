import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import sinon from 'sinon';
import config from 'config';
import i18next from 'i18next';

import AccountApplication from '@/common/model/application';
import ApplicationConfirmationEmail from '@/server/accounts/model/application_confirmation_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

beforeAll(async () => {
  // Eagerly load the email namespace for both languages so synchronous
  // i18next.t() lookups (used by renderSubject) resolve translated content
  // instead of falling back to the default language.
  await i18next.loadLanguages(['en', 'fr']);
  await i18next.loadNamespaces('application_confirmation_email');
});

describe('ApplicationConfirmationEmail', () => {

  let sandbox = sinon.createSandbox();
  const token = 'test-confirmation-token-abc123';

  afterEach(() => {
    sandbox.restore();
  });

  it('should build message with the applicant email address', () => {
    const application = new AccountApplication('app-id', 'applicant@example.com');
    const email = new ApplicationConfirmationEmail(application, token, 'Riverside Events');

    const message = email.buildMessage('en');

    expect(message.emailAddress).toBe('applicant@example.com');
  });

  it('should include the confirmation URL with token in plaintext', () => {
    const domain = config.get<string>('domain');
    const application = new AccountApplication('app-id', 'applicant@example.com');
    const email = new ApplicationConfirmationEmail(application, token, 'Riverside Events');

    const message = email.buildMessage('en');

    expect(message.textMessage).toContain('https://' + domain + '/auth/apply/confirm/' + token);
  });

  it('should include the confirmation URL with token in HTML', () => {
    const domain = config.get<string>('domain');
    const application = new AccountApplication('app-id', 'applicant@example.com');
    const email = new ApplicationConfirmationEmail(application, token, 'Riverside Events');

    const message = email.buildMessage('en');

    expect(message.htmlMessage).toContain('https://' + domain + '/auth/apply/confirm/' + token);
  });

  it('should render a CTA label in HTML', () => {
    const application = new AccountApplication('app-id', 'applicant@example.com');
    const email = new ApplicationConfirmationEmail(application, token, 'Riverside Events');

    const message = email.buildMessage('en');

    expect(message.htmlMessage).toContain('Confirm my email');
  });

  it('should render an expiration notice in plaintext', () => {
    const application = new AccountApplication('app-id', 'applicant@example.com');
    const email = new ApplicationConfirmationEmail(application, token, 'Riverside Events');

    const message = email.buildMessage('en');

    expect(message.textMessage).toContain('expires');
  });

  it('should have a non-empty subject line', () => {
    const application = new AccountApplication('app-id', 'applicant@example.com');
    const email = new ApplicationConfirmationEmail(application, token, 'Riverside Events');

    const message = email.buildMessage('en');

    expect(message.subject).toBeTruthy();
    expect(message.subject).toContain('Confirm');
  });

  it('should render French content when language is fr', () => {
    const domain = config.get<string>('domain');
    const application = new AccountApplication('app-id', 'applicant@example.com');
    const email = new ApplicationConfirmationEmail(application, token, 'Riverside Events');

    const message = email.buildMessage('fr');

    expect(message.subject).toContain('Confirmez');
    expect(message.htmlMessage).toContain('Confirmer mon e-mail');
    expect(message.textMessage).toContain('https://' + domain + '/auth/apply/confirm/' + token);
  });

  it('should produce identical content for the same token (no resend hint)', () => {
    const application = new AccountApplication('app-id', 'applicant@example.com');

    const firstSend = new ApplicationConfirmationEmail(application, token, 'Riverside Events').buildMessage('en');
    const resend = new ApplicationConfirmationEmail(application, token, 'Riverside Events').buildMessage('en');

    expect(resend.subject).toBe(firstSend.subject);
    expect(resend.textMessage).toBe(firstSend.textMessage);
    expect(resend.htmlMessage).toBe(firstSend.htmlMessage);
  });
});

describe('ApplicationConfirmationEmail sign-off', () => {
  const build = (name: string) => new ApplicationConfirmationEmail(new AccountApplication('app-id', 'a@example.com'), 'tok', name);

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
