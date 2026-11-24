import { describe, it, expect, beforeAll } from 'vitest';
import config from 'config';
import i18next from 'i18next';

import AccountApplication from '@/common/model/application';
import AdminApplicationNotificationEmail from '@/server/accounts/model/admin_application_notification_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

beforeAll(async () => {
  // Eagerly load the email namespace so synchronous i18next.t() lookups
  // (used by renderSubject) resolve translated content.
  await i18next.loadLanguages(['en']);
  await i18next.loadNamespaces('admin_application_notification_email');
});

/**
 * Tests for AdminApplicationNotificationEmail model.
 *
 * Verifies the email model is constructed with the correct namespace,
 * addresses the recipient admin, renders a subject + text + html body,
 * and includes the applicant's email in the rendered body (the only
 * applicant-identifying field in the message — the free-text message is
 * intentionally omitted per the privacy decision in the bead notes).
 */
describe('AdminApplicationNotificationEmail', () => {
  const applicantEmail = 'applicant@example.com';

  function makeApplication(): AccountApplication {
    return new AccountApplication('app-id', applicantEmail, 'sensitive message text');
  }

  it('constructs with the admin_application_notification_email namespace', () => {
    const email = new AdminApplicationNotificationEmail('admin@example.com', makeApplication(), 'Riverside Events');

    expect(email.namespace).toBe('admin_application_notification_email');
  });

  it('sets the recipient address to the admin email passed to the constructor', () => {
    const email = new AdminApplicationNotificationEmail('admin@example.com', makeApplication(), 'Riverside Events');

    const mailData = email.buildMessage('en');

    expect(mailData.emailAddress).toBe('admin@example.com');
  });

  it('renders a non-empty subject line', () => {
    const email = new AdminApplicationNotificationEmail('admin@example.com', makeApplication(), 'Riverside Events');

    const mailData = email.buildMessage('en');

    expect(mailData.subject).toBeTruthy();
    expect(mailData.subject.length).toBeGreaterThan(0);
  });

  it('renders non-empty text and html bodies', () => {
    const email = new AdminApplicationNotificationEmail('admin@example.com', makeApplication(), 'Riverside Events');

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toBeDefined();
    expect(mailData.textMessage.length).toBeGreaterThan(0);
    expect(mailData.htmlMessage).toBeDefined();
    expect(mailData.htmlMessage!.length).toBeGreaterThan(0);
  });

  it('includes the applicant email and a review deep link in the rendered body, and never the applicant free-text message', () => {
    const email = new AdminApplicationNotificationEmail('admin@example.com', makeApplication(), 'Riverside Events');

    const mailData = email.buildMessage('en');
    const expectedReviewUrl = 'https://' + config.get<string>('domain') + '/settings/admin/accounts';

    expect(mailData.textMessage).toContain(applicantEmail);
    expect(mailData.htmlMessage).toContain(applicantEmail);
    expect(mailData.textMessage).toContain(expectedReviewUrl);
    expect(mailData.htmlMessage).toContain(expectedReviewUrl);

    // Privacy invariant: the applicant's free-text message must never appear
    // in the rendered output — admins read it from the in-app queue, not from
    // their mailbox.
    expect(mailData.textMessage).not.toContain('sensitive message text');
    expect(mailData.htmlMessage).not.toContain('sensitive message text');
  });
});

describe('AdminApplicationNotificationEmail sign-off', () => {
  const build = (name: string) => new AdminApplicationNotificationEmail('admin@example.com', new AccountApplication('app-id', 'a@example.com', 'm'), name);

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
