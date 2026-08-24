import { describe, it, expect, beforeAll } from 'vitest';
import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import AccountService from '@/server/accounts/service/account';
import ModerationService from '@/server/moderation/service/moderation';
import { AccountRoleEntity } from '@/server/common/entity/account';
import { CalendarMemberEntity } from '@/server/calendar/entity/calendar_member';
import { ReportEntity } from '@/server/moderation/entity/report';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import NotificationService from '@/server/notifications/service/notification';
import NotificationEventHandlers from '@/server/notifications/events';
import { dispatchAndAwait } from '@/server/common/test/helpers/emit-and-settle';
import { MODERATION_BUS_EVENTS } from '@/server/moderation/events/types';
import type { NotificationResponse } from '@/common/model/notification';

/**
 * Integration coverage for the notification read path's target derivation
 * (pv-mvfk.3).
 *
 * These cases cannot be proved by unit tests over the pure derivation,
 * because each depends on state owned by another domain reaching the read
 * path intact:
 *
 *   - **Rename survival.** Resolving url names at read time (rather than
 *     snapshotting them on the activity row) is what keeps links live across
 *     a calendar rename. Nothing else in the epic tests it, and it is an
 *     emergent property of the read path, not of any single function.
 *   - **The report audience invariant.** `owner_report` is only safe because
 *     report notifications reach calendar owners and instance admins and
 *     nobody else. That is established by the real audience resolution in
 *     `NotificationEventHandlers`, so the test drives the real bus event
 *     against real calendar membership — if audience resolution ever adds
 *     editors, this fails.
 *   - **Live role reads.** Owner-vs-admin surface selection is asserted
 *     against real `account_role` rows, not a stubbed role.
 *   - **Report-calendar immutability.** The denormalized
 *     `object_calendar_id` is a routing key, so a reassignment path in
 *     moderation would silently route owners to another calendar's reports.
 *   - **Role drift on admin-addressed report verbs.** Pins the accepted
 *     outcome for a recipient addressed as an admin who reads the row after
 *     demotion — see the test's own comment for why this is deliberate.
 */
describe('notification read path — target derivation (integration)', () => {
  let env: TestEnvironment;
  let eventBus: EventEmitter;
  let calendarInterface: CalendarInterface;
  let accountsInterface: AccountsInterface;
  let notificationService: NotificationService;
  let ownerAccount: Account;
  let editorAccount: Account;
  let adminAccount: Account;
  let unrelatedAccount: Account;
  let calendar: Calendar;

  const eventId = uuidv4();
  const reportId = uuidv4();

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    accountsInterface = new AccountsInterface(
      eventBus,
      configurationInterface,
      setupInterface,
    );
    calendarInterface = new CalendarInterface(eventBus, accountsInterface);
    const accountService = new AccountService(
      eventBus,
      configurationInterface,
      setupInterface,
    );

    notificationService = new NotificationService({
      calendarInterface,
      accountsInterface,
    });
    new NotificationEventHandlers(
      notificationService,
      calendarInterface,
      accountsInterface,
    ).install(eventBus);

    const ownerInfo = await accountService._setupAccount('read-path-owner@pavillion.dev', 'testpassword');
    ownerAccount = ownerInfo.account;
    calendar = await calendarInterface.createCalendar(ownerAccount, 'readpathcal');

    const editorInfo = await accountService._setupAccount('read-path-editor@pavillion.dev', 'testpassword');
    editorAccount = editorInfo.account;
    await CalendarMemberEntity.create({
      id: uuidv4(),
      calendar_id: calendar.id,
      account_id: editorAccount.id,
      role: 'editor',
      granted_by: ownerAccount.id,
    });

    const adminInfo = await accountService._setupAccount('read-path-admin@pavillion.dev', 'testpassword');
    adminAccount = adminInfo.account;

    const unrelatedInfo = await accountService._setupAccount('read-path-unrelated@pavillion.dev', 'testpassword');
    unrelatedAccount = unrelatedInfo.account;

    // `_setupAccount` auto-grants the first account in the test DB the admin
    // role so setup-mode middleware does not block other suites. Normalize
    // the admin pool to a single explicit admin — otherwise the owner would
    // be an admin too and every report row would resolve to the moderation
    // surface.
    await AccountRoleEntity.destroy({ where: { role: 'admin' } });
    await AccountRoleEntity.create({ account_id: adminAccount.id, role: 'admin' });

    // One real Flag through the real handler: audience resolution, the
    // label snapshot, and `object_calendar_id` persistence all run as they do
    // in production.
    await dispatchAndAwait(eventBus, MODERATION_BUS_EVENTS.REPORT_FLAGGED, {
      reportId,
      eventId,
      calendarId: calendar.id,
      origin: 'local',
    });
  });

  async function inboxFor(account: Account): Promise<NotificationResponse[]> {
    return notificationService.getNotifications(account.id, 50, 0);
  }

  it('sends the calendar owner to their own calendar\'s reports tab', async () => {
    const inbox = await inboxFor(ownerAccount);

    expect(inbox).toHaveLength(1);
    expect(inbox[0].verb).toBe('Flag');
    expect(inbox[0].object.target).toEqual({
      kind: 'owner_report',
      reportId,
      calendarUrlName: 'readpathcal',
    });
  });

  it('sends the instance admin to the moderation queue for the same report', async () => {
    // Same activity row, different live role. The surface comes from the
    // account_role read, never from the presence of a calendar id on the row.
    const inbox = await inboxFor(adminAccount);

    expect(inbox).toHaveLength(1);
    expect(inbox[0].activityId).toBe((await inboxFor(ownerAccount))[0].activityId);
    expect(inbox[0].object.target).toEqual({
      kind: 'moderation_report',
      reportId,
    });
  });

  it('never emits owner_report to an account outside owners ∪ instance admins', async () => {
    // Invariant 1, as live data rather than code inspection. Editors have
    // edit rights on the calendar but the reports tab is owner-gated, so an
    // owner_report target would point them at a blocked surface. The
    // protection is that they are not in the report audience at all.
    const owners = await calendarInterface.getOwnersForCalendar(calendar.id);
    const adminIds = await accountsInterface.getInstanceAdmins();
    const entitled = new Set([...owners.map((o) => o.id), ...adminIds]);

    const everyone = [ownerAccount, editorAccount, adminAccount, unrelatedAccount];
    const recipientsOfOwnerReport: string[] = [];
    for (const account of everyone) {
      const inbox = await inboxFor(account);
      if (inbox.some((row) => row.object.target?.kind === 'owner_report')) {
        recipientsOfOwnerReport.push(account.id);
      }
    }

    expect(recipientsOfOwnerReport).toEqual([ownerAccount.id]);
    for (const accountId of recipientsOfOwnerReport) {
      expect(entitled.has(accountId)).toBe(true);
    }

    // The editor is not merely unlinked — they never received the row.
    expect(await inboxFor(editorAccount)).toEqual([]);
    expect(await inboxFor(unrelatedAccount)).toEqual([]);
  });

  it('keeps the link live across a calendar rename', async () => {
    // Goal 2 of the epic. The url name is resolved at read time, so a rename
    // is picked up on the next inbox load with no backfill of stored rows.
    const before = await inboxFor(ownerAccount);
    expect(before[0].object.target).toMatchObject({ calendarUrlName: 'readpathcal' });

    await calendarInterface.setUrlName(ownerAccount, calendar, 'renamedreadpathcal');

    const after = await inboxFor(ownerAccount);
    expect(after[0].object.target).toEqual({
      kind: 'owner_report',
      reportId,
      calendarUrlName: 'renamedreadpathcal',
    });

    // Restore so ordering between tests cannot matter.
    await calendarInterface.setUrlName(ownerAccount, calendar, 'readpathcal');
  });

  it('gives a dual-role viewer the moderation surface (invariant 2)', async () => {
    // Live promotion: the owner becomes an instance admin and the very next
    // read flips their surface, because the role is read per call rather than
    // cached for the session.
    await AccountRoleEntity.create({ account_id: ownerAccount.id, role: 'admin' });
    try {
      const inbox = await inboxFor(ownerAccount);

      expect(inbox[0].object.target).toEqual({
        kind: 'moderation_report',
        reportId,
      });
    }
    finally {
      await AccountRoleEntity.destroy({
        where: { account_id: ownerAccount.id, role: 'admin' },
      });
    }

    // ...and demotion is equally immediate.
    const afterDemotion = await inboxFor(ownerAccount);
    expect(afterDemotion[0].object.target).toMatchObject({ kind: 'owner_report' });
  });

  it('still hands owner_report to a demoted admin-addressed recipient — accepted role drift, not a defect', async () => {
    // This pins a KNOWN AND ACCEPTED outcome. Do not "fix" it with a
    // membership check.
    //
    // Invariant 1's structural guarantee is exact only for `Flag`, whose
    // audience and stored `object_calendar_id` both derive from the same
    // `payload.calendarId`. `ReportEscalated` addresses instance-admins and
    // `ReportResolved` addresses the reviewer, so neither recipient need own
    // the report's calendar. If such a recipient later loses the admin role,
    // the live role read correctly returns false and drops them into the owner
    // branch — handing them `owner_report` for a calendar they do not own.
    //
    // Accepted because the target is an affordance and never a trust boundary
    // (invariant 5): the destination enforces `userCanReviewReports`
    // server-side, `url_name` is public routing data, and the report id was
    // already on the row as `object.id` before targets existed.
    //
    // Two repairs were considered and rejected; see the invariant 1 notes in
    // `service/notification-target.ts` for the full reasoning.
    //   - A per-row cross-domain owner-membership lookup: it reintroduces the
    //     per-row cross-domain traffic this read path is designed to avoid,
    //     and answering it from the stored `object_calendar_id` instead would
    //     make that routing key a policy surface (DEC-013 analogue, DEC-015).
    //   - Blanket `null` for a non-admin viewer of ReportEscalated /
    //     ReportResolved: wrong for ReportResolved, whose activity is
    //     addressed to the reviewer and whose reviewer is recorded
    //     `reviewerRole: 'owner'` — the main use case is a calendar owner
    //     resolving a report on their own calendar, for whom the
    //     `owner_report` link is correct.
    const escalatedReportId = uuidv4();
    await dispatchAndAwait(eventBus, MODERATION_BUS_EVENTS.REPORT_ESCALATED, {
      reportId: escalatedReportId,
      eventId,
      calendarId: calendar.id,
      reason: 'escalation threshold reached',
    });

    const asAdmin = (await inboxFor(adminAccount))
      .find(row => row.object.id === escalatedReportId);
    expect(asAdmin!.verb).toBe('ReportEscalated');
    expect(asAdmin!.object.target).toEqual({
      kind: 'moderation_report',
      reportId: escalatedReportId,
    });

    await AccountRoleEntity.destroy({
      where: { account_id: adminAccount.id, role: 'admin' },
    });
    try {
      // The demoted account is emphatically not an owner of this calendar.
      const owners = await calendarInterface.getOwnersForCalendar(calendar.id);
      expect(owners.map(o => o.id)).not.toContain(adminAccount.id);

      const afterDemotion = (await inboxFor(adminAccount))
        .find(row => row.object.id === escalatedReportId);
      expect(afterDemotion!.object.target).toEqual({
        kind: 'owner_report',
        reportId: escalatedReportId,
        calendarUrlName: 'readpathcal',
      });
    }
    finally {
      await AccountRoleEntity.create({ account_id: adminAccount.id, role: 'admin' });
    }
  });

  // ---------------------------------------------------------------------------
  // Invariant 6 — a report's owning calendar is immutable after creation
  // ---------------------------------------------------------------------------

  describe('report calendar immutability', () => {
    /**
     * Identifier names in `source` that hold a `ReportEntity`: the model class
     * itself, plus every local bound to a `ReportEntity` query result — either
     * directly or by iterating a collection of them.
     *
     * Narrowing the scan to these receivers is what keeps the tripwire honest.
     * A scan over every `.update(` in the file also matched
     * `createHmac(...).update(email...)` in `hashEmail` — a Node crypto call,
     * not a database write — and picked up unrelated report columns from other
     * entities besides. Either one turns this into a test that fails for
     * reasons unconnected to report reassignment.
     */
    function reportEntityReceivers(source: string): Set<string> {
      const receivers = new Set(['ReportEntity']);

      const bindings = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+ReportEntity\./g;
      for (const match of source.matchAll(bindings)) {
        receivers.add(match[1]);
      }

      // `for (const entity of reportsToEscalate)` — the loop variable holds a
      // ReportEntity whenever the iterated collection does.
      const loops = /\bfor\s*\(\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s+of\s+([A-Za-z_$][\w$]*)\s*\)/g;
      for (const match of source.matchAll(loops)) {
        if (receivers.has(match[2])) {
          receivers.add(match[1]);
        }
      }

      return receivers;
    }

    /**
     * The first-argument object literal of every Sequelize write issued through
     * a `ReportEntity` receiver, brace-matched so nested objects are not
     * truncated (regex alone cannot do that).
     *
     * The match requires `\.update\(\s*\{` — only whitespace may separate the
     * call from its object literal. A call whose first argument is not an
     * object literal is therefore skipped outright rather than causing a walk
     * forward into whatever unrelated block happens to come next.
     */
    function reportUpdatePayloads(source: string, receivers: Set<string>): string[] {
      const alternation = [...receivers].join('|');
      const writes = new RegExp(`\\b(?:${alternation})\\.update\\(\\s*\\{`, 'g');

      const payloads: string[] = [];
      for (const match of source.matchAll(writes)) {
        const open = match.index + match[0].length - 1;
        let depth = 0;
        let index = open;
        for (; index < source.length; index++) {
          if (source[index] === '{') depth++;
          else if (source[index] === '}') {
            depth--;
            if (depth === 0) break;
          }
        }
        payloads.push(source.slice(open, index + 1));
      }
      return payloads;
    }

    it('has no moderation update path that writes calendar_id', () => {
      // `object_calendar_id` on notification_activity is a denormalized copy
      // of ReportEntity.calendar_id, and it is only safe because the source
      // is write-once. A reassignment path would leave stored notifications
      // pointing at the previous calendar — routing an owner to a DIFFERENT
      // calendar's reports tab. If this test starts failing, the copy needs a
      // write-through, not a relaxed assertion.
      const source = readFileSync(
        path.resolve(__dirname, '../../../moderation/service/moderation.ts'),
        'utf8',
      );
      const receivers = reportEntityReceivers(source);
      const payloads = reportUpdatePayloads(source, receivers);

      // Guard the extractor itself: too few payloads would make the assertion
      // below vacuously true. Most report writes go through an *instance*
      // (`entity.update(...)`), not the model class, so a receiver set that has
      // collapsed to `ReportEntity` alone means the binding scan stopped
      // recognising them. The moderation service has ~15 report update paths
      // today; the floor is deliberately slack, but not slack enough to survive
      // the matcher breaking.
      expect(receivers.size).toBeGreaterThan(1);
      expect(payloads.length).toBeGreaterThanOrEqual(10);
      for (const payload of payloads) {
        expect(payload).not.toContain('calendar_id');
      }
    });

    it('preserves calendar_id across a report\'s lifecycle transitions', async () => {
      const moderationService = new ModerationService(eventBus, calendarInterface);
      const lifecycleReportId = uuidv4();
      await ReportEntity.create({
        id: lifecycleReportId,
        event_id: uuidv4(),
        calendar_id: calendar.id,
        category: 'spam',
        description: 'lifecycle fixture',
        reporter_type: 'authenticated',
        status: 'submitted',
      });

      await moderationService.updateReportNotes(lifecycleReportId, 'owner looked at this');
      await moderationService.resolveReport(lifecycleReportId, ownerAccount.id, 'handled');

      const stored = await ReportEntity.findByPk(lifecycleReportId);
      expect(stored!.calendar_id).toBe(calendar.id);
    });
  });
});
