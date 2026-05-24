import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { Op } from 'sequelize';

import db from '@/server/common/entity/db';
import { AccountEntity } from '@/server/common/entity/account';
import {
  NotificationActivityEntity,
  NotificationRecipientEntity,
} from '@/server/notifications/entity/notification_activity';
import NotificationService, {
  type ResolveRoleAudienceFn,
} from '@/server/notifications/service/notification';
import type CalendarInterface from '@/server/calendar/interface';
import type AccountsInterface from '@/server/accounts/interface';

/**
 * Integration tests for `NotificationService.recordActivity` (pv-89mw.3.4).
 *
 * The central insert path needs full-stack integration
 * coverage for three invariants the unit tests cannot prove:
 *   1. Empty-audience contract — `kind='role'` against a role-holderless
 *      object still inserts the activity row, zero recipients, no error.
 *   2. Concurrent dedup invariant — two concurrent calls for the same
 *      (verb, actor, object) tuple result in exactly one activity row.
 *   3. Flag anonymization DB invariant — `actor_account_id IS NULL AND
 *      actor_uri IS NULL` for every persisted Flag row, regardless of
 *      input actor kind.
 *
 * This suite does NOT use `TestEnvironment` because the test environment
 * imports `server.ts`, which transitively imports modules owned by later
 * beads (event handlers, API surface) that are still broken in this wave.
 * Instead the suite syncs the DB directly via `db.sync({ force: true })`
 * — the same pattern the retention-cleanup integration test uses.
 */
describe('NotificationService.recordActivity (integration)', () => {
  let service: NotificationService;
  let calendarInterfaceStub: CalendarInterface;
  let accountsInterfaceStub: AccountsInterface;
  let resolveRoleAudienceFn: ResolveRoleAudienceFn;
  let resolvedAccountIds: string[];
  let resolverCallCount: number;

  beforeAll(async () => {
    await db.sync({ force: true });
  });

  afterAll(async () => {
    // SQLite :memory: tears down with the process; no explicit close needed.
  });

  beforeEach(async () => {
    // Clear notification tables in dependent order before each test so the
    // dedup window calculations work against a known state.
    await NotificationRecipientEntity.destroy({ where: {}, truncate: true });
    await NotificationActivityEntity.destroy({ where: {}, truncate: true });
    await AccountEntity.destroy({ where: {}, truncate: true, cascade: true });

    resolvedAccountIds = [];
    resolverCallCount = 0;
    // Closure-based resolver injection: each test sets resolvedAccountIds
    // to the desired audience and the service consumes it. Avoids stubbing
    // the cross-domain interfaces which would require dragging in the full
    // calendar/accounts setup.
    resolveRoleAudienceFn = async () => {
      resolverCallCount += 1;
      return resolvedAccountIds;
    };

    calendarInterfaceStub = {} as CalendarInterface;
    accountsInterfaceStub = {} as AccountsInterface;
    service = new NotificationService(
      {
        calendarInterface: calendarInterfaceStub,
        accountsInterface: accountsInterfaceStub,
      },
      resolveRoleAudienceFn,
    );
  });

  /**
   * Seed N accounts and return their IDs. Convenience for the audience-
   * resolution paths that need real account rows to validate against.
   */
  async function seedAccounts(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = uuidv4();
      await AccountEntity.create({
        id,
        username: `rec-act-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        email: `rec-act-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@pavillion.dev`,
        language: 'en',
      });
      ids.push(id);
    }
    return ids;
  }

  // ---------------------------------------------------------------------------
  // Empty-audience contract
  // ---------------------------------------------------------------------------

  describe('empty-audience contract', () => {
    it('inserts the activity row with zero recipients when kind=role resolves to empty list', async () => {
      // Resolver returns [] — simulates a calendar with no editors, or an
      // instance with no admins.
      resolvedAccountIds = [];

      const calendarId = uuidv4();
      await service.recordActivity({
        verb: 'Follow',
        actor: { kind: 'remote_actor', uri: 'https://example.org/users/alice' },
        object: { type: 'calendar', id: calendarId, label: 'Empty Calendar' },
        audience: {
          kind: 'role',
          role: 'calendar-editors',
          objectRef: { type: 'calendar', id: calendarId },
        },
        actorDisplayName: 'Alice',
        origin: 'federated',
      });

      // Activity row IS persisted (audit trail exists).
      const activities = await NotificationActivityEntity.findAll({
        where: { verb: 'Follow', object_id: calendarId },
      });
      expect(activities).toHaveLength(1);
      expect(activities[0].verb).toBe('Follow');
      expect(activities[0].object_id).toBe(calendarId);

      // No recipient rows.
      const recipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: activities[0].id },
      });
      expect(recipients).toHaveLength(0);

      // Resolver was invoked exactly once even though there were no
      // recipients to write — proves the empty-list branch is the
      // resolver's output, not a short-circuit before resolution.
      expect(resolverCallCount).toBe(1);
    });

    it('inserts the activity row with zero recipients when kind=explicit resolves to empty list after validation', async () => {
      // No real accounts exist for these IDs — all silently dropped.
      const ghostId1 = uuidv4();
      const ghostId2 = uuidv4();

      const calendarId = uuidv4();
      await service.recordActivity({
        verb: 'EditorInvited',
        actor: { kind: 'account', accountId: uuidv4() },
        object: { type: 'calendar', id: calendarId, label: 'Test Calendar' },
        audience: { kind: 'explicit', accountIds: [ghostId1, ghostId2] },
        actorDisplayName: 'Owner',
      });

      const activities = await NotificationActivityEntity.findAll({
        where: { verb: 'EditorInvited', object_id: calendarId },
      });
      expect(activities).toHaveLength(1);

      const recipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: activities[0].id },
      });
      expect(recipients).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Concurrent dedup invariant
  // ---------------------------------------------------------------------------

  describe('concurrent dedup invariant', () => {
    /**
     * Note on the concurrency model under SQLite:
     *
     * The production target is Postgres with connection pooling; concurrent
     * `recordActivity` calls each acquire their own connection and run their
     * transactions in parallel. The SQLite :memory: test backend has a
     * single connection by design (the in-memory database is per-connection)
     * and cannot support genuinely-overlapping transactions.
     *
     * The cross-recipient invariant under genuine concurrency is enforced
     * by SERIALIZABLE isolation (see `recordActivity` and the corresponding
     * unit tests that stub `db.transaction` to verify the isolation level
     * and the serialization-failure retry loop). At the integration layer
     * we verify the in-transaction dedup check returns the canonical winner
     * when a prior matching row exists:
     *
     *   (a) Sequential calls — the second call sees the first's committed
     *       row and short-circuits via the in-transaction dedup check.
     *   (b) Pre-seeded winner — a matching row is inserted directly via
     *       the entity layer; the subsequent service call must observe it
     *       and dedup without producing a second activity row.
     */
    it('sequential calls — second call dedups and does not insert a second activity row', async () => {
      const [recipientA] = await seedAccounts(1);
      resolvedAccountIds = [recipientA];

      const calendarId = uuidv4();
      const payload = {
        verb: 'Follow' as const,
        actor: { kind: 'remote_actor' as const, uri: 'https://example.org/users/concurrent-1' },
        object: { type: 'calendar' as const, id: calendarId, label: 'Concurrency Calendar 1' },
        audience: {
          kind: 'role' as const,
          role: 'calendar-editors' as const,
          objectRef: { type: 'calendar' as const, id: calendarId },
        },
        actorDisplayName: 'Concurrent',
        origin: 'federated' as const,
      };

      await service.recordActivity(payload);
      await service.recordActivity(payload);

      // Exactly one activity row exists — the second call's dedup hit
      // suppressed its insert.
      const allActivities = await NotificationActivityEntity.findAll({
        where: { verb: 'Follow', object_id: calendarId },
      });
      expect(allActivities).toHaveLength(1);

      // Recipient fan-out happened exactly once (no double-fan-out on
      // the dedup path).
      const recipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: allActivities[0].id },
      });
      expect(recipients).toHaveLength(1);
      expect(recipients[0].account_id).toBe(recipientA);
    });

    it('matching row already in DB — call dedups without a second insert (cross-recipient invariant)', async () => {
      // Stronger variant of the sequential test: simulate the case where a
      // concurrent writer already committed a matching row before our call
      // ran. Pre-insert the winner directly via the entity, then call
      // recordActivity with the same dedup key and verify the in-
      // transaction dedup check finds the winner and returns it.
      const [recipientA] = await seedAccounts(1);
      resolvedAccountIds = [recipientA];

      const calendarId = uuidv4();
      const actorUri = 'https://example.org/users/concurrent-3';

      const winner = await NotificationActivityEntity.create({
        verb: 'Follow',
        origin: 'federated',
        actor_kind: 'remote_actor',
        actor_account_id: null,
        actor_uri: actorUri,
        actor_display_name: 'Concurrent',
        actor_display_url: null,
        object_type: 'calendar',
        object_id: calendarId,
        object_label: 'Cross-Recipient Calendar',
      });

      await service.recordActivity({
        verb: 'Follow',
        actor: { kind: 'remote_actor', uri: actorUri },
        object: { type: 'calendar', id: calendarId, label: 'Cross-Recipient Calendar' },
        audience: {
          kind: 'role',
          role: 'calendar-editors',
          objectRef: { type: 'calendar', id: calendarId },
        },
        actorDisplayName: 'Concurrent',
        origin: 'federated',
      });

      // Exactly one activity row exists overall — the pre-seeded winner
      // suppressed the service call's insert.
      const allActivities = await NotificationActivityEntity.findAll({
        where: { verb: 'Follow', object_id: calendarId },
      });
      expect(allActivities).toHaveLength(1);
      expect(allActivities[0].id).toBe(winner.id);

      // No recipient rows were inserted by the dedup path (the winner was
      // pre-seeded outside the service so its own fan-out is not present
      // here; the assertion is specifically about *this* call not
      // double-fanning out).
      const recipientsForWinner = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: winner.id },
      });
      expect(recipientsForWinner).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Flag dedup key (object-only — two anonymous Flags within 10 minutes on the
  // same object dedupe; two Flags on different objects do not)
  // ---------------------------------------------------------------------------

  describe('Flag dedup key (object-only, no actor component)', () => {
    it('two anonymous Flags on the SAME object within the window dedupe to one activity row', async () => {
      const [adminAccount] = await seedAccounts(1);
      resolvedAccountIds = [adminAccount];

      const sharedReportId = uuidv4();

      await service.recordActivity({
        verb: 'Flag',
        actor: { kind: 'anonymous' },
        object: { type: 'report', id: sharedReportId, label: 'Reported event' },
        audience: { kind: 'role', role: 'instance-admins' },
      });

      // Second Flag — different actor input but same object. The dedup
      // key on Flag is (verb, object_type, object_id) only — no actor
      // component — so this collapses into the first.
      await service.recordActivity({
        verb: 'Flag',
        actor: { kind: 'remote_actor', uri: 'https://remote.example/users/different-reporter' },
        object: { type: 'report', id: sharedReportId, label: 'Reported event' },
        audience: { kind: 'role', role: 'instance-admins' },
        origin: 'federated',
      });

      const flagRows = await NotificationActivityEntity.findAll({
        where: { verb: 'Flag', object_id: sharedReportId },
      });
      expect(flagRows).toHaveLength(1);

      // Exactly one fan-out occurred (the winner's).
      const recipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: flagRows[0].id },
      });
      expect(recipients).toHaveLength(1);
    });

    it('two Flags on DIFFERENT objects within the window both insert (no dedup across objects)', async () => {
      const [adminAccount] = await seedAccounts(1);
      resolvedAccountIds = [adminAccount];

      const reportIdA = uuidv4();
      const reportIdB = uuidv4();

      await service.recordActivity({
        verb: 'Flag',
        actor: { kind: 'anonymous' },
        object: { type: 'report', id: reportIdA, label: 'Report A' },
        audience: { kind: 'role', role: 'instance-admins' },
      });

      await service.recordActivity({
        verb: 'Flag',
        actor: { kind: 'anonymous' },
        object: { type: 'report', id: reportIdB, label: 'Report B' },
        audience: { kind: 'role', role: 'instance-admins' },
      });

      const allFlagRows = await NotificationActivityEntity.findAll({
        where: { verb: 'Flag', object_id: { [Op.in]: [reportIdA, reportIdB] } },
      });
      expect(allFlagRows).toHaveLength(2);

      // Each call produced its own recipient fan-out.
      const recipientCount = await NotificationRecipientEntity.count({
        where: {
          notification_activity_id: { [Op.in]: allFlagRows.map((r) => r.id) },
        },
      });
      expect(recipientCount).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Flag actor anonymization DB invariant
  // ---------------------------------------------------------------------------

  describe('Flag actor anonymization invariant', () => {
    it('every persisted Flag row has actor_account_id IS NULL AND actor_uri IS NULL regardless of input actor', async () => {
      const [adminAccount] = await seedAccounts(1);
      resolvedAccountIds = [adminAccount];

      // Exercise all three Flag actor input paths in sequence.
      await service.recordActivity({
        verb: 'Flag',
        actor: { kind: 'account', accountId: uuidv4() },
        object: { type: 'report', id: uuidv4(), label: 'Local-account Flag' },
        audience: { kind: 'role', role: 'instance-admins' },
        actorDisplayName: 'Should Not Survive',
        actorDisplayUrl: 'https://pavillion.dev/users/realname',
      });

      await service.recordActivity({
        verb: 'Flag',
        actor: { kind: 'remote_actor', uri: 'https://remote.example/users/alice' },
        object: { type: 'report', id: uuidv4(), label: 'Remote AP Flag' },
        audience: { kind: 'role', role: 'instance-admins' },
        origin: 'federated',
      });

      await service.recordActivity({
        verb: 'Flag',
        actor: { kind: 'anonymous' },
        object: { type: 'report', id: uuidv4(), label: 'Anonymous web-form Flag' },
        audience: { kind: 'role', role: 'instance-admins' },
      });

      // DB invariant: the targeted query form must
      // return exactly zero leaky Flag rows. This is the canonical
      // assertion the design calls for; it proves the storage-layer
      // invariant in a single targeted SQL query rather than relying on
      // row-by-row iteration.
      const leakyFlagCount = await NotificationActivityEntity.count({
        where: {
          verb: 'Flag',
          [Op.or]: [
            { actor_account_id: { [Op.ne]: null } },
            { actor_uri: { [Op.ne]: null } },
          ],
        },
      });
      expect(leakyFlagCount).toBe(0);

      const totalFlagRows = await NotificationActivityEntity.count({
        where: { verb: 'Flag' },
      });
      expect(totalFlagRows).toBe(3);

      const allFlagRows = await NotificationActivityEntity.findAll({
        where: { verb: 'Flag' },
      });
      // Per-row assertions extend coverage to the sanitization-layer
      // outputs (display name/url i18n token shape). The privacy
      // invariant itself is established by `leakyFlagCount` above.
      for (const row of allFlagRows) {
        expect(row.actor_account_id).toBeNull();
        expect(row.actor_uri).toBeNull();
        expect(row.actor_kind).toBe('anonymous');
      }

      // Specifically: the remote_actor path stores the hostname-only
      // attribution URL; the other two paths store null.
      const remoteRow = allFlagRows.find((r) => r.object_label === 'Remote AP Flag');
      expect(remoteRow!.actor_display_url).toBe('https://remote.example');
      expect(remoteRow!.actor_display_name).toContain('remote.example');

      const localRow = allFlagRows.find((r) => r.object_label === 'Local-account Flag');
      expect(localRow!.actor_display_url).toBeNull();
      expect(localRow!.actor_display_name).toBe('i18n:flag_actor_anonymous');

      const webRow = allFlagRows.find((r) => r.object_label === 'Anonymous web-form Flag');
      expect(webRow!.actor_display_url).toBeNull();
      expect(webRow!.actor_display_name).toBe('i18n:flag_actor_anonymous');
    });
  });

  // ---------------------------------------------------------------------------
  // Full happy path through the DB
  // ---------------------------------------------------------------------------

  describe('end-to-end happy path', () => {
    it('inserts activity + recipient rows for role-based audience', async () => {
      const accounts = await seedAccounts(3);
      resolvedAccountIds = accounts;

      const calendarId = uuidv4();
      await service.recordActivity({
        verb: 'Follow',
        actor: { kind: 'remote_actor', uri: 'https://example.org/users/alice' },
        object: { type: 'calendar', id: calendarId, label: 'Test Calendar' },
        audience: {
          kind: 'role',
          role: 'calendar-editors',
          objectRef: { type: 'calendar', id: calendarId },
        },
        actorDisplayName: 'Alice',
        origin: 'federated',
      });

      const activities = await NotificationActivityEntity.findAll({
        where: { verb: 'Follow', object_id: calendarId },
      });
      expect(activities).toHaveLength(1);
      const activity = activities[0];
      expect(activity.origin).toBe('federated');
      expect(activity.actor_kind).toBe('remote_actor');
      expect(activity.actor_uri).toBe('https://example.org/users/alice');
      expect(activity.actor_display_name).toBe('Alice');
      expect(activity.object_type).toBe('calendar');
      expect(activity.object_id).toBe(calendarId);

      const recipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: activity.id },
      });
      expect(recipients).toHaveLength(3);
      const recipientAccountIds = recipients.map((r) => r.account_id).sort();
      expect(recipientAccountIds).toEqual([...accounts].sort());
    });

    it('inserts activity + recipient rows for validated explicit audience', async () => {
      const [realAccount] = await seedAccounts(1);
      const ghostAccount = uuidv4();

      const calendarId = uuidv4();
      await service.recordActivity({
        verb: 'EditorInvited',
        actor: { kind: 'account', accountId: uuidv4() },
        object: { type: 'calendar', id: calendarId, label: 'Test Calendar' },
        // realAccount exists; ghostAccount does not — must be dropped silently.
        audience: { kind: 'explicit', accountIds: [realAccount, ghostAccount] },
        actorDisplayName: 'Owner',
      });

      const activities = await NotificationActivityEntity.findAll({
        where: { verb: 'EditorInvited', object_id: calendarId },
      });
      expect(activities).toHaveLength(1);

      const recipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: activities[0].id },
      });
      expect(recipients).toHaveLength(1);
      expect(recipients[0].account_id).toBe(realAccount);
    });
  });
});
