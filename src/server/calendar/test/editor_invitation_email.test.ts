import { describe, it, expect } from 'vitest';
import config from 'config';

import { Account } from '@/common/model/account';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import AccountInvitation from '@/common/model/invitation';
import EditorInvitationEmail from '@/server/calendar/model/editor_invitation_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

const INVITE_CODE = 'abc123def456';

function buildEmail(message?: string): EditorInvitationEmail {
  const inviter = new Account('inviter-id', 'inviter', 'inviter@example.com');
  const invitation = new AccountInvitation('invite-id', 'invitee@example.com', inviter, message);
  const calendar = new Calendar('calendar-id', 'test_calendar');
  calendar.addContent(new CalendarContent('en', 'Test Calendar'));
  return new EditorInvitationEmail(invitation, INVITE_CODE, calendar);
}

describe('EditorInvitationEmail', () => {
  const expectedLink = `https://${config.get('domain')}/auth/invitation?code=${INVITE_CODE}`;

  it('addresses the invitee', () => {
    const message = buildEmail().buildMessage('en');

    expect(message.emailAddress).toBe('invitee@example.com');
    expect(message.subject).toBeTruthy();
  });

  it('renders the absolute invitation link in the plaintext body', () => {
    const message = buildEmail().buildMessage('en');

    expect(message.textMessage).toContain(expectedLink);
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
});
