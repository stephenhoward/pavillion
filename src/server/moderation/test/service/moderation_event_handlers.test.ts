import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Report, ReportCategory, ReportStatus } from '@/common/model/report';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { Account } from '@/common/model/account';
import ModerationEventHandlers from '@/server/moderation/events';
import { MODERATION_BUS_EVENTS } from '@/server/moderation/events/types';
import ModerationInterface from '@/server/moderation/interface';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import { MailData } from '@/server/email/model/types';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

/**
 * Targeted coverage for `ModerationEventHandlers.getCalendarName`. This
 * handler intentionally diverges from the notifications domain's plain
 * `'Calendar'` fallback by preferring the calendar's `urlName` slug over
 * the generic `'Unknown Calendar'` string. The behavior is the only thing
 * pinning that divergence — without this test the next refactor could
 * collapse onto the notifications convention without anyone noticing.
 */
describe('ModerationEventHandlers getCalendarName urlName precedence', () => {
  let sandbox: sinon.SinonSandbox;
  let moderationInterface: ModerationInterface;
  let calendarInterface: CalendarInterface;
  let accountsInterface: AccountsInterface;
  let emailInterface: EmailInterface;
  let sentEmails: MailData[];

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sentEmails = [];

    moderationInterface = {} as ModerationInterface;
    calendarInterface = {} as CalendarInterface;
    accountsInterface = {} as AccountsInterface;
    emailInterface = {
      sendEmail: async (data: MailData) => {
        sentEmails.push(data);
        return null;
      },
    } as unknown as EmailInterface;
  });

  afterEach(() => {
    sandbox.restore();
  });

  /**
   * Drives `handleEscalated` end-to-end with a scheduler-driven reason so
   * the admin-notification email pipeline runs and `getCalendarName` is
   * exercised. Asserts on the rendered email body since the email is the
   * only externally observable carrier of the calendar-name label.
   */
  async function runAutoEscalation(calendar: Calendar | null): Promise<MailData[]> {
    const report = Report.fromObject({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      eventId: 'event-id',
      calendarId: 'cal-id',
      category: ReportCategory.SPAM,
      description: 'Test report',
      reporterType: 'authenticated',
      status: ReportStatus.ESCALATED,
      createdAt: new Date('2026-05-14T12:00:00Z'),
    });

    const event = new CalendarEvent('event-id', 'cal-id');
    const ownerAccount = new Account('owner-id', 'owner', 'owner@example.test');
    const adminAccount = new Account('admin-id', 'admin', 'admin@example.test');
    adminAccount.roles = ['admin'];

    (moderationInterface as any).getReportById = sandbox.stub().resolves(report);
    (calendarInterface as any).getCalendarOwnerAccountId = sandbox.stub().resolves('owner-id');
    (calendarInterface as any).getEventById = sandbox.stub().resolves(event);
    (calendarInterface as any).getCalendar = sandbox.stub().resolves(calendar);
    (accountsInterface as any).getAccountById = sandbox.stub().resolves(ownerAccount);
    (accountsInterface as any).getAdmins = sandbox.stub().resolves([adminAccount]);

    const handlers = new ModerationEventHandlers(
      moderationInterface,
      calendarInterface,
      accountsInterface,
      emailInterface,
    );

    await (handlers as any).handleEscalated({
      reportId: report.id,
      calendarId: 'cal-id',
      reason: 'Auto-escalated due to owner inaction',
    });

    return sentEmails;
  }

  it('uses calendar.urlName as the calendar-name label when no translated name is populated', async () => {
    // A calendar with a slug but no translated content must surface the
    // slug — not the generic 'Unknown Calendar' fallback. This is the
    // intentional divergence from the notifications-domain convention.
    const calendar = new Calendar('cal-id', 'community-hub');

    const emails = await runAutoEscalation(calendar);

    expect(emails).toHaveLength(1);
    expect(emails[0].textMessage).toContain('community-hub');
    expect(emails[0].textMessage).not.toContain('Unknown Calendar');
  });

  it('uses \'Unknown Calendar\' when the calendar lookup returns null', async () => {
    // Counter-example pinning the fallback path: with no calendar at all
    // there is no urlName to surface, so the generic fallback applies.
    const emails = await runAutoEscalation(null);

    expect(emails).toHaveLength(1);
    expect(emails[0].textMessage).toContain('Unknown Calendar');
  });

  it('falls back to \'Unknown Calendar\' when getCalendar throws (urlName unavailable)', async () => {
    // `getCalendarName` has its own try/catch — a transient lookup
    // failure swallows the error and falls back to 'Unknown Calendar'
    // so the admin escalation email still ships. This pins the
    // error-path fallback rather than urlName precedence.
    (moderationInterface as any).getReportById = sandbox.stub().resolves(
      Report.fromObject({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        eventId: 'event-id',
        calendarId: 'cal-id',
        category: ReportCategory.SPAM,
        description: 'Test report',
        reporterType: 'authenticated',
        status: ReportStatus.ESCALATED,
        createdAt: new Date('2026-05-14T12:00:00Z'),
      }),
    );
    (calendarInterface as any).getCalendarOwnerAccountId = sandbox.stub().resolves('owner-id');
    (calendarInterface as any).getEventById = sandbox.stub().resolves(new CalendarEvent('event-id', 'cal-id'));
    (calendarInterface as any).getCalendar = sandbox.stub().rejects(new Error('lookup failed'));

    const ownerAccount = new Account('owner-id', 'owner', 'owner@example.test');
    const adminAccount = new Account('admin-id', 'admin', 'admin@example.test');
    adminAccount.roles = ['admin'];
    (accountsInterface as any).getAccountById = sandbox.stub().resolves(ownerAccount);
    (accountsInterface as any).getAdmins = sandbox.stub().resolves([adminAccount]);

    const handlers = new ModerationEventHandlers(
      moderationInterface,
      calendarInterface,
      accountsInterface,
      emailInterface,
    );

    await (handlers as any).handleEscalated({
      reportId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      calendarId: 'cal-id',
      reason: 'Auto-escalated due to owner inaction',
    });

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].textMessage).toContain('Unknown Calendar');
  });
});

/**
 * Suppress the unused-import warning for MODERATION_BUS_EVENTS. The
 * constant documents that handleEscalated is wired to the bus event
 * `moderation:report:escalated` even though the test calls the handler
 * method directly.
 */
void MODERATION_BUS_EVENTS;
