import { describe, it, expect } from 'vitest';
import config from 'config';

import { Account } from '@/common/model/account';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import AccountInvitation from '@/common/model/invitation';
import EditorInvitationEmail from '@/server/calendar/model/editor_invitation_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

const INVITE_CODE = 'abc123def456';

function buildEmail(message?: string, inviterName = 'Dana Organizer'): EditorInvitationEmail {
  const inviter = new Account('inviter-id', 'inviter', 'inviter@example.com');
  const invitation = new AccountInvitation('invite-id', 'invitee@example.com', inviter, message);
  const calendar = new Calendar('calendar-id', 'test_calendar');
  for (const language of ['en', 'es', 'fr']) {
    calendar.addContent(new CalendarContent(language, 'Test Calendar'));
  }
  return new EditorInvitationEmail(invitation, INVITE_CODE, calendar, { instanceName: 'Riverside Events', inviterName });
}

describe('EditorInvitationEmail', () => {
  const expectedLink = `https://${config.get('domain')}/auth/invitation?code=${INVITE_CODE}`;

  it('addresses the invitee', () => {
    const message = buildEmail().buildMessage('en');

    expect(message.emailAddress).toBe('invitee@example.com');
    expect(message.subject).toBeTruthy();
  });

  it('renders the absolute invitation link in the plaintext body', () => {
    expect(buildEmail().buildMessage('en').textMessage).toContain(expectedLink);
  });

  it('renders the absolute invitation link as the button href in the HTML body', () => {
    const message = buildEmail().buildMessage('en');

    expect(message.htmlMessage).toContain(`href="${expectedLink}"`);
    expect(message.htmlMessage).not.toMatch(/href=""/);
  });

  it('includes the inviter personal message when one is provided', () => {
    const message = buildEmail('Please join us').buildMessage('en');

    expect(message.textMessage).toContain('Please join us');
    expect(message.htmlMessage).toContain('Please join us');
  });

  it.each([
    ['en', 'Hello,'],
    ['es', 'Hola,'],
    ['fr', 'Bonjour,'],
  ])('names instance, calendar and inviter in the recipient language (%s)', (language, greeting) => {
    const message = buildEmail().buildMessage(language);

    expect(message.subject).toContain('Riverside Events');
    expect(message.subject).toContain('Test Calendar');
    expect(message.subject).not.toContain('Pavillion');
    for (const body of [message.textMessage, message.htmlMessage]) {
      expect(body).toContain(greeting);
      expect(body).toContain('Riverside Events');
      expect(body).toContain('Test Calendar');
      expect(body).toContain('Dana Organizer');
      expect(body).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
      expect(body).not.toContain('Pavillion');
    }
  });

  it('does not HTML-escape the plain-text part', () => {
    const email = buildEmail('It\'s Q&A time');
    email.context.instanceName = 'Stephen\'s Arts & Crafts';
    const message = email.buildMessage('en');

    expect(message.textMessage).toContain('Stephen\'s Arts & Crafts');
    expect(message.textMessage).toContain('It\'s Q&A time');
    expect(message.textMessage).not.toContain('&#');
    expect(message.textMessage).not.toContain('&amp;');
  });

  it('uses the no-inviter sentence when the inviter is unknown', () => {
    const message = buildEmail('Hi', '').buildMessage('en');

    expect(message.textMessage).toContain('You have been invited to become an editor');
    expect(message.textMessage).toContain('Personal message:');
  });
});
