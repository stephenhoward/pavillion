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
    const email = new ApplicationConfirmationEmail(application, token);

    const message = email.buildMessage('en');

    expect(message.emailAddress).toBe('applicant@example.com');
  });

  it('should include the confirmation URL with token in plaintext', () => {
    const domain = config.get<string>('domain');
    const application = new AccountApplication('app-id', 'applicant@example.com');
    const email = new ApplicationConfirmationEmail(application, token);

    const message = email.buildMessage('en');

    expect(message.textMessage).toContain(domain + '/auth/apply/confirm/' + token);
  });

  it('should include the confirmation URL with token in HTML', () => {
    const domain = config.get<string>('domain');
    const application = new AccountApplication('app-id', 'applicant@example.com');
    const email = new ApplicationConfirmationEmail(application, token);

    const message = email.buildMessage('en');

    expect(message.htmlMessage).toContain(domain + '/auth/apply/confirm/' + token);
  });

  it('should render a CTA label in HTML', () => {
    const application = new AccountApplication('app-id', 'applicant@example.com');
    const email = new ApplicationConfirmationEmail(application, token);

    const message = email.buildMessage('en');

    expect(message.htmlMessage).toContain('Confirm my email');
  });

  it('should render an expiration notice in plaintext', () => {
    const application = new AccountApplication('app-id', 'applicant@example.com');
    const email = new ApplicationConfirmationEmail(application, token);

    const message = email.buildMessage('en');

    expect(message.textMessage).toContain('expires');
  });

  it('should have a non-empty subject line', () => {
    const application = new AccountApplication('app-id', 'applicant@example.com');
    const email = new ApplicationConfirmationEmail(application, token);

    const message = email.buildMessage('en');

    expect(message.subject).toBeTruthy();
    expect(message.subject).toContain('Confirm');
  });

  it('should render French content when language is fr', () => {
    const domain = config.get<string>('domain');
    const application = new AccountApplication('app-id', 'applicant@example.com');
    const email = new ApplicationConfirmationEmail(application, token);

    const message = email.buildMessage('fr');

    expect(message.subject).toContain('Confirmez');
    expect(message.htmlMessage).toContain('Confirmer mon e-mail');
    expect(message.textMessage).toContain(domain + '/auth/apply/confirm/' + token);
  });

  it('should produce identical content for the same token (no resend hint)', () => {
    const application = new AccountApplication('app-id', 'applicant@example.com');

    const firstSend = new ApplicationConfirmationEmail(application, token).buildMessage('en');
    const resend = new ApplicationConfirmationEmail(application, token).buildMessage('en');

    expect(resend.subject).toBe(firstSend.subject);
    expect(resend.textMessage).toBe(firstSend.textMessage);
    expect(resend.htmlMessage).toBe(firstSend.htmlMessage);
  });
});
