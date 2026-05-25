import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import db from '@/server/common/entity/db';
import { AccountEntity } from '@/server/common/entity/account';
import {
  NotificationActivityEntity,
  NotificationRecipientEntity,
} from '@/server/notifications/entity/notification_activity';
import NotificationService, {
  type ResolveRoleAudienceFn,
} from '@/server/notifications/service/notification';
import NotificationEventHandlers from '@/server/notifications/events';
import type CalendarInterface from '@/server/calendar/interface';
import type AccountsInterface from '@/server/accounts/interface';

import ModerationService from '@/server/moderation/service/moderation';
import { ReportEntity } from '@/server/moderation/entity/report';
import { ReportEscalationEntity } from '@/server/moderation/entity/report_escalation';
import { MODERATION_BUS_EVENTS } from '@/server/moderation/events/types';
import {
  ReportCategory,
  ReportStatus,
} from '@/common/model/report';
import { settleAsyncHandlers } from '@/server/common/test/helpers/emit-and-settle';

/**
 * Integration tests for the admin terminal-decision → notifications-domain
 * dismissal chain (pv-vdu2.3).
 *
 * Verifies that `adminDismissReport` and `adminOverrideReport` both emit
 * `MODERATION_BUS_EVENTS.REPORT_RESOLVED`, which the notifications handler
 * subscribes to and routes through `dismissForObject`. The end-to-end
 * assertion is that any open Flag / ReportEscalated recipient row tied to
 * the resolved report is stamped with `dismissed_at` once the admin action
 * completes.
 *
 * The owner-side `resolveReport` and admin-side `adminResolveReport` paths
 * were already wired in pv-89mw; this bead closes the asymmetry on the
 * dismiss/override admin terminal paths.
 *
 * dismissForObject's `WHERE dismissed_at IS NULL` guard makes it safe for
 * any future code path to over-emit `REPORT_RESOLVED` — the idempotency
 * invariant is exercised explicitly below.
 *
 * This suite follows the pattern of `dismiss-for-object.test.ts`: direct
 * `db.sync({ force: true })` instead of `TestEnvironment` so it does not
 * pick up unrelated server-bootstrap modules.
 */
describe('admin terminal-decision → notifications dismissal (integration)', () => {
  let eventBus: EventEmitter;
  let moderationService: ModerationService;
  let notificationService: NotificationService;
  let handlers: NotificationEventHandlers;

  beforeAll(async () => {
    await db.sync({ force: true });
  });

  beforeEach(async () => {
    await NotificationRecipientEntity.destroy({ where: {}, truncate: true });
    await NotificationActivityEntity.destroy({ where: {}, truncate: true });
    await ReportEscalationEntity.destroy({ where: {}, truncate: true });
    await ReportEntity.destroy({ where: {}, truncate: true });
    await AccountEntity.destroy({ where: {}, truncate: true, cascade: true });

    eventBus = new EventEmitter();

    // Stubs are no-ops — the REPORT_RESOLVED handler addresses only the
    // explicit reviewer recipient and never invokes the role resolver.
    const calendarInterface = {
      getEditorsForCalendar: async () => [],
      getOwnersForCalendar: async () => [],
    } as unknown as CalendarInterface;
    const accountsInterface = {
      getInstanceAdmins: async (): Promise<string[]> => [],
    } as unknown as AccountsInterface;

    const resolveRoleAudienceFn: ResolveRoleAudienceFn = async () => [];

    notificationService = new NotificationService(
      { calendarInterface, accountsInterface },
      resolveRoleAudienceFn,
    );

    handlers = new NotificationEventHandlers(
      notificationService,
      calendarInterface,
      accountsInterface,
    );
    handlers.install(eventBus);

    moderationService = new ModerationService(eventBus);
  });

  /**
   * Seed an account row. `notification_recipient.account_id` has an FK to
   * accounts; admins / reviewers in this suite must exist as real rows.
   */
  async function seedAccount(prefix: string): Promise<string> {
    const id = uuidv4();
    await AccountEntity.create({
      id,
      username: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      email: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@pavillion.dev`,
      language: 'en',
    });
    return id;
  }

  /**
   * Insert a Report row in the supplied initial status, plus a Flag
   * activity row scoped to the report with one open recipient per admin.
   * Returns the row IDs so the test can assert on dismissed_at afterwards.
   */
  async function seedReportAndFlag(args: {
    initialStatus: ReportStatus;
    calendarId: string;
    adminIds: string[];
  }): Promise<{ reportId: string; flagId: string; recipientIds: string[] }> {
    const reportId = uuidv4();
    await ReportEntity.create({
      id: reportId,
      event_id: uuidv4(),
      calendar_id: args.calendarId,
      category: ReportCategory.SPAM,
      description: 'Seeded for admin terminal dismissal test',
      reporter_type: 'authenticated',
      status: args.initialStatus,
    } as any);

    const flag = await NotificationActivityEntity.create({
      verb: 'Flag',
      origin: 'local',
      actor_kind: 'anonymous',
      actor_account_id: null,
      actor_uri: null,
      actor_display_name: 'Anonymous reporter',
      actor_display_url: null,
      object_type: 'report',
      object_id: reportId,
      object_label: 'Reported event',
    });

    const recipientIds: string[] = [];
    for (const adminId of args.adminIds) {
      const recipient = await NotificationRecipientEntity.create({
        notification_activity_id: flag.id,
        account_id: adminId,
      });
      recipientIds.push(recipient.id);
    }

    return { reportId, flagId: flag.id, recipientIds };
  }

  it('adminDismissReport closes prior Flag recipient rows via REPORT_RESOLVED', async () => {
    const adminA = await seedAccount('term-dis-a');
    const adminB = await seedAccount('term-dis-b');
    const reviewerId = await seedAccount('term-dis-rev');
    const calendarId = uuidv4();

    const { reportId, flagId } = await seedReportAndFlag({
      initialStatus: ReportStatus.ESCALATED,
      calendarId,
      adminIds: [adminA, adminB],
    });

    await moderationService.adminDismissReport(reportId, reviewerId, 'Not actionable');
    await settleAsyncHandlers();

    const flagRecipients = await NotificationRecipientEntity.findAll({
      where: { notification_activity_id: flagId },
    });
    expect(flagRecipients).toHaveLength(2);
    for (const r of flagRecipients) {
      expect(r.dismissed_at).not.toBeNull();
    }
  });

  it('adminOverrideReport closes prior Flag recipient rows via REPORT_RESOLVED', async () => {
    const adminA = await seedAccount('term-ovr-a');
    const reviewerId = await seedAccount('term-ovr-rev');
    const calendarId = uuidv4();

    const { reportId, flagId } = await seedReportAndFlag({
      initialStatus: ReportStatus.SUBMITTED,
      calendarId,
      adminIds: [adminA],
    });

    await moderationService.adminOverrideReport(reportId, reviewerId, 'Reversed owner decision');
    await settleAsyncHandlers();

    const flagRecipients = await NotificationRecipientEntity.findAll({
      where: { notification_activity_id: flagId },
    });
    expect(flagRecipients).toHaveLength(1);
    expect(flagRecipients[0].dismissed_at).not.toBeNull();
  });

  it('dismissForObject is idempotent — a second admin-dismiss emit preserves the first run timestamp', async () => {
    // The acceptance criteria call this out explicitly: dismissForObject's
    // `WHERE dismissed_at IS NULL` guard means any future over-emission of
    // REPORT_RESOLVED — including a hypothetical retry of an admin terminal
    // action — does not overwrite the first-run dismissal timestamp.
    const adminA = await seedAccount('term-idem-a');
    const reviewerId = await seedAccount('term-idem-rev');
    const calendarId = uuidv4();

    const { reportId, flagId } = await seedReportAndFlag({
      initialStatus: ReportStatus.ESCALATED,
      calendarId,
      adminIds: [adminA],
    });

    await moderationService.adminDismissReport(reportId, reviewerId, 'First run');
    await settleAsyncHandlers();

    const afterFirst = await NotificationRecipientEntity.findOne({
      where: { notification_activity_id: flagId, account_id: adminA },
    });
    const firstDismissedAt = afterFirst!.dismissed_at;
    expect(firstDismissedAt).not.toBeNull();

    // Wait so a non-idempotent UPDATE would produce a different timestamp.
    await new Promise(resolve => setTimeout(resolve, 50));

    // Re-emit REPORT_RESOLVED directly — we can't call adminDismissReport
    // again because the report is already in a terminal state and the
    // service guards against double-termination. The bus event is what
    // the notifications handler subscribes to, so emitting it directly
    // exercises the idempotency invariant the design calls out.
    eventBus.emit(MODERATION_BUS_EVENTS.REPORT_RESOLVED, {
      reportId,
      eventId: uuidv4(),
      calendarId,
      reviewerId,
    });
    await settleAsyncHandlers();

    const afterSecond = await NotificationRecipientEntity.findOne({
      where: { notification_activity_id: flagId, account_id: adminA },
    });
    expect(afterSecond!.dismissed_at?.getTime()).toBe(firstDismissedAt?.getTime());
  });
});
