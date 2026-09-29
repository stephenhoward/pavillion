import { describe, it, expect } from 'vitest';
import handlebars from 'handlebars';
import { EmailMessage } from '@/server/common/email/message';
import { MailData } from '@/server/common/email/types';
import { Account } from '@/common/model/account';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import AccountInvitation from '@/common/model/invitation';
import EditorInvitationEmail from '@/server/calendar/model/editor_invitation_email';
import EditorNotificationEmail from '@/server/calendar/model/editor_notification_email';
import BackupFailedEmail from '@/server/housekeeping/model/backup-failed-email';
import DiskWarningEmail from '@/server/housekeeping/model/disk-warning-email';
import DiskCriticalEmail from '@/server/housekeeping/model/disk-critical-email';
import AdminReportNotificationEmail from '@/server/moderation/model/admin_report_notification_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

/**
 * Subject lines are rendered by i18next (not Handlebars), so their
 * {{placeholders}} are filled only if renderSubject passes its data through
 * as interpolation options. These tests run against the real locale files.
 */

class SubjectOnlyEmail extends EmailMessage {
  constructor(namespace: string) {
    super(namespace, handlebars.compile(''));
  }

  buildMessage(language: string): MailData {
    return { emailAddress: 'x@example.com', subject: this.renderSubject(language, {}), textMessage: '' };
  }
}

const calendarNamed = (name: string, language: string = 'en'): Calendar => {
  const calendar = new Calendar('cal-1', 'test-calendar');
  const content = new CalendarContent(language);
  content.name = name;
  calendar.addContent(content);
  return calendar;
};

describe('EmailMessage.renderSubject interpolation', () => {
  it('fills a subject placeholder from the data argument', () => {
    const email = new SubjectOnlyEmail('editor_invitation_email');

    expect(email.renderSubject('en', { calendarName: 'Town Hall' }))
      .toBe('You\'ve been invited to edit Town Hall');
  });

  it('does not HTML-escape interpolated values in the plain-text subject', () => {
    const email = new SubjectOnlyEmail('editor_notification_email');

    expect(email.renderSubject('en', { calendarName: 'Arts & Crafts <Kids\' "Club">' }))
      .toBe('You can now edit Arts & Crafts <Kids\' "Club">');
  });
});

describe('email subjects with placeholders', () => {
  const inviter = new Account('acc-1', 'inviter', 'inviter@example.com');
  const recipient = new Account('acc-2', 'editor', 'editor@example.com');

  it('editor invitation subject names the calendar', () => {
    const invitation = new AccountInvitation('inv-1', 'new@example.com', inviter);
    const email = new EditorInvitationEmail(invitation, 'code-123', calendarNamed('Rock & Roll'));

    expect(email.buildMessage('en').subject).toBe('You\'ve been invited to edit Rock & Roll');
  });

  it('editor notification subject names the calendar', () => {
    const email = new EditorNotificationEmail(calendarNamed('Rock & Roll'), inviter, recipient);

    expect(email.buildMessage('en').subject).toBe('You can now edit Rock & Roll');
  });

  it('backup failed subject names the backup type and file', () => {
    const email = new BackupFailedEmail('daily', 'backup-2026.sql', 'boom', '2026-09-29', 'admin@example.com');

    expect(email.buildMessage('en').subject).toBe('❌ Backup Failed: daily backup of backup-2026.sql');
  });

  it('disk warning subject carries the usage percentage', () => {
    const email = new DiskWarningEmail(85.25, 80, '/', '85G', '100G', 'admin@example.com');

    expect(email.buildMessage('en').subject).toBe('⚠️ Disk Space Warning: 85.3% used');
  });

  it('disk critical subject carries the usage percentage', () => {
    const email = new DiskCriticalEmail(96, 95, '/', '96G', '100G', 'admin@example.com');

    expect(email.buildMessage('en').subject).toBe('🚨 CRITICAL: Disk Space at 96.0%');
  });

  it('admin report subject carries the priority exactly once', () => {
    const email = new AdminReportNotificationEmail(
      'owner@example.com', 'Event', 'Calendar', 'spam', 'desc', 'high', null, 'cal-1',
    );

    expect(email.buildMessage('en').subject).toBe('[HIGH] Admin report on your event');
  });
});
