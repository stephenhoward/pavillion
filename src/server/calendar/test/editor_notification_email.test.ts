import { describe, it, expect } from 'vitest';

import { Account } from '@/common/model/account';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import EditorNotificationEmail from '@/server/calendar/model/editor_notification_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

const INVITER_EMAIL = 'inviter-private@example.com';

function buildEmail(displayName: string | null, username: string, message?: string): EditorNotificationEmail {
  const inviter = new Account('inviter-id', username, INVITER_EMAIL);
  inviter.displayName = displayName;
  const recipient = new Account('recipient-id', 'recipient', 'recipient@example.com');
  const calendar = new Calendar('calendar-id', 'test_calendar');
  for (const language of ['en', 'es', 'fr']) {
    calendar.addContent(new CalendarContent(language, 'Test Calendar'));
  }
  return new EditorNotificationEmail(calendar, inviter, recipient, message);
}

describe('EditorNotificationEmail', () => {
  it('names the inviter by display name', () => {
    const message = buildEmail('Dana Organizer', 'dana', 'Welcome').buildMessage('en');

    expect(message.emailAddress).toBe('recipient@example.com');
    expect(message.textMessage).toContain('Dana Organizer has granted you editor access');
    expect(message.textMessage).toContain('Personal message from Dana Organizer:');
    expect(message.htmlMessage).toContain('Dana Organizer');
  });

  it('falls back to the username when there is no display name', () => {
    const message = buildEmail('  ', 'dana').buildMessage('en');

    expect(message.textMessage).toContain('dana has granted you editor access');
  });

  it('uses the no-inviter wording when neither name exists', () => {
    for (const language of ['en', 'es', 'fr']) {
      const message = buildEmail(null, '', 'Welcome').buildMessage(language);

      expect(message.textMessage).not.toContain('notification_message');
      expect(message.textMessage).not.toContain('undefined');
      expect(message.textMessage).toContain('Test Calendar');
    }
    const en = buildEmail(null, '', 'Welcome').buildMessage('en');
    expect(en.textMessage).toContain('You have been granted editor access');
    expect(en.textMessage).toContain('Personal message:');
  });

  it('never includes the inviter email address in any rendering', () => {
    for (const [displayName, username] of [['Dana Organizer', 'dana'], [null, 'dana'], [null, '']] as const) {
      for (const language of ['en', 'es', 'fr']) {
        const message = buildEmail(displayName, username, 'Hi').buildMessage(language);

        expect(message.textMessage).not.toContain(INVITER_EMAIL);
        expect(message.htmlMessage).not.toContain(INVITER_EMAIL);
        expect(message.subject).not.toContain(INVITER_EMAIL);
      }
    }
  });
});
