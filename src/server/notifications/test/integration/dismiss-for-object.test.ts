import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
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
import type CalendarInterface from '@/server/calendar/interface';
import type AccountsInterface from '@/server/accounts/interface';

/**
 * Integration tests for `NotificationService.dismissForObject` (pv-89mw.3.5).
 *
 * The method runs a single
 * UPDATE against `notification_recipient` joined to `notification_activity`
 * on `(object_type, object_id)` plus optional verb/actor filters, setting
 * `dismissed_at = NOW() WHERE dismissed_at IS NULL`.
 *
 * The invariants verified here:
 *   1. Object-scoped (no actor filter) dismisses all recipients for all
 *      matching activities.
 *   2. Actor-scoped (actorUri filter) only dismisses recipients of
 *      activities whose preserved-identity column matches.
 *   3. Idempotent — a second call does not overwrite the first run's
 *      `dismissed_at` timestamps.
 *   4. Flag actor-filter no-op — Flag rows store NULL identity columns
 *      so an actor filter against a Flag activity dismisses nothing.
 *
 * This suite does NOT use `TestEnvironment` because it imports `server.ts`
 * which transitively pulls in modules owned by later beads (event handlers,
 * API surface) that are still broken in this wave. Instead it syncs the DB
 * directly via `db.sync({ force: true })` — same pattern as
 * `record-activity.test.ts` and `retention-cleanup.test.ts`.
 */
describe('NotificationService.dismissForObject (integration)', () => {
  let service: NotificationService;
  let resolveRoleAudienceFn: ResolveRoleAudienceFn;

  beforeAll(async () => {
    await db.sync({ force: true });
  });

  afterAll(async () => {
    // SQLite :memory: tears down with the process; no explicit close needed.
  });

  beforeEach(async () => {
    // Clear notification tables in dependent order before each test so the
    // assertions work against a known state.
    await NotificationRecipientEntity.destroy({ where: {}, truncate: true });
    await NotificationActivityEntity.destroy({ where: {}, truncate: true });
    await AccountEntity.destroy({ where: {}, truncate: true, cascade: true });

    // Resolver is unused by dismissForObject; provide a no-op for the
    // constructor.
    resolveRoleAudienceFn = async () => [];

    service = new NotificationService(
      {
        calendarInterface: {} as CalendarInterface,
        accountsInterface: {} as AccountsInterface,
      },
      resolveRoleAudienceFn,
    );
  });

  /**
   * Seed N accounts and return their IDs. Convenience for tests that need
   * real account rows because `notification_recipient.account_id` has an
   * FK constraint on the accounts table.
   */
  async function seedAccounts(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = uuidv4();
      await AccountEntity.create({
        id,
        username: `dismiss-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        email: `dismiss-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@pavillion.dev`,
        language: 'en',
      });
      ids.push(id);
    }
    return ids;
  }

  /**
   * Seed an activity row plus one recipient row per supplied account. The
   * activity defaults match a remote-actor Announce; tests override what
   * they need.
   */
  async function seedActivityWithRecipients(
    overrides: {
      verb?: string;
      origin?: string;
      actor_kind?: string;
      actor_account_id?: string | null;
      actor_uri?: string | null;
      object_type?: string;
      object_id?: string;
      object_label?: string;
    },
    recipientAccountIds: string[],
  ): Promise<{ activity: NotificationActivityEntity; recipients: NotificationRecipientEntity[] }> {
    const activity = await NotificationActivityEntity.create({
      verb: overrides.verb ?? 'Announce',
      origin: overrides.origin ?? 'federated',
      actor_kind: overrides.actor_kind ?? 'remote_actor',
      actor_account_id: overrides.actor_account_id ?? null,
      actor_uri: overrides.actor_uri ?? null,
      actor_display_name: 'Test Actor',
      actor_display_url: null,
      object_type: overrides.object_type ?? 'event',
      object_id: overrides.object_id ?? uuidv4(),
      object_label: overrides.object_label ?? 'Test Object',
    });
    const recipients: NotificationRecipientEntity[] = [];
    for (const accountId of recipientAccountIds) {
      const recipient = await NotificationRecipientEntity.create({
        notification_activity_id: activity.id,
        account_id: accountId,
      });
      recipients.push(recipient);
    }
    return { activity, recipients };
  }

  // ---------------------------------------------------------------------------
  // Object-scoped (no actor filter)
  // ---------------------------------------------------------------------------

  describe('object-scoped (no actor filter)', () => {
    it('dismisses all recipients of all activities matching (object_type, object_id)', async () => {
      const accounts = await seedAccounts(4);
      const reportId = uuidv4();

      // Two activities on the same report — a Flag and a ReportEscalated.
      const flag = await seedActivityWithRecipients(
        {
          verb: 'Flag',
          origin: 'local',
          actor_kind: 'anonymous',
          actor_account_id: null,
          actor_uri: null,
          object_type: 'report',
          object_id: reportId,
        },
        [accounts[0], accounts[1]],
      );
      const escalated = await seedActivityWithRecipients(
        {
          verb: 'ReportEscalated',
          origin: 'local',
          actor_kind: 'system',
          actor_account_id: null,
          actor_uri: null,
          object_type: 'report',
          object_id: reportId,
        },
        [accounts[2], accounts[3]],
      );

      // Unrelated activity on a *different* report — must not be touched.
      const otherReport = await seedActivityWithRecipients(
        {
          verb: 'Flag',
          origin: 'local',
          actor_kind: 'anonymous',
          object_type: 'report',
          object_id: uuidv4(),
        },
        [accounts[0]],
      );

      const before = Date.now();
      await service.dismissForObject({
        objectType: 'report',
        objectId: reportId,
      });
      const after = Date.now();

      // All four recipients for the two matching activities are dismissed.
      const flagRecipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: flag.activity.id },
      });
      const escalatedRecipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: escalated.activity.id },
      });
      for (const r of [...flagRecipients, ...escalatedRecipients]) {
        expect(r.dismissed_at).not.toBeNull();
        const ts = r.dismissed_at!.getTime();
        // Allow a 1 second wall-clock fudge — the DB clock and the JS
        // clock are the same process so the bound is tight.
        expect(ts).toBeGreaterThanOrEqual(before - 1000);
        expect(ts).toBeLessThanOrEqual(after + 1000);
      }

      // Unrelated report's recipient remains untouched.
      const untouched = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: otherReport.activity.id },
      });
      expect(untouched).toHaveLength(1);
      expect(untouched[0].dismissed_at).toBeNull();
    });

    it('respects the verbs filter — only dismisses recipients of activities matching the verb list', async () => {
      const accounts = await seedAccounts(3);
      const reportId = uuidv4();

      const flag = await seedActivityWithRecipients(
        {
          verb: 'Flag',
          origin: 'local',
          actor_kind: 'anonymous',
          object_type: 'report',
          object_id: reportId,
        },
        [accounts[0]],
      );
      const escalated = await seedActivityWithRecipients(
        {
          verb: 'ReportEscalated',
          origin: 'local',
          actor_kind: 'system',
          object_type: 'report',
          object_id: reportId,
        },
        [accounts[1]],
      );
      // Same object_id, different verb — must not be touched when filtered out.
      const resolved = await seedActivityWithRecipients(
        {
          verb: 'ReportResolved',
          origin: 'local',
          actor_kind: 'account',
          actor_account_id: accounts[2],
          object_type: 'report',
          object_id: reportId,
        },
        [accounts[2]],
      );

      await service.dismissForObject({
        objectType: 'report',
        objectId: reportId,
        verbs: ['Flag', 'ReportEscalated'],
      });

      const flagRecipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: flag.activity.id },
      });
      const escalatedRecipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: escalated.activity.id },
      });
      const resolvedRecipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: resolved.activity.id },
      });

      expect(flagRecipients[0].dismissed_at).not.toBeNull();
      expect(escalatedRecipients[0].dismissed_at).not.toBeNull();
      // ReportResolved was excluded from the verbs filter — stays open.
      expect(resolvedRecipients[0].dismissed_at).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Actor-scoped (actorUri filter)
  // ---------------------------------------------------------------------------

  describe('actor-scoped (actorUri filter)', () => {
    it('dismisses only the matching remote actor\'s recipients, leaves others intact', async () => {
      const accounts = await seedAccounts(4);
      const eventId = uuidv4();
      const actorA = 'https://remote-a.example/users/alice';
      const actorB = 'https://remote-b.example/users/bob';

      const announceA = await seedActivityWithRecipients(
        {
          verb: 'Announce',
          origin: 'federated',
          actor_kind: 'remote_actor',
          actor_uri: actorA,
          object_type: 'event',
          object_id: eventId,
        },
        [accounts[0], accounts[1]],
      );
      const announceB = await seedActivityWithRecipients(
        {
          verb: 'Announce',
          origin: 'federated',
          actor_kind: 'remote_actor',
          actor_uri: actorB,
          object_type: 'event',
          object_id: eventId,
        },
        [accounts[2], accounts[3]],
      );

      await service.dismissForObject({
        objectType: 'event',
        objectId: eventId,
        verbs: ['Announce'],
        actorUri: actorA,
      });

      const aRecipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: announceA.activity.id },
      });
      const bRecipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: announceB.activity.id },
      });

      expect(aRecipients).toHaveLength(2);
      for (const r of aRecipients) {
        expect(r.dismissed_at).not.toBeNull();
      }

      // Actor B's recipients must be untouched — the cross-actor isolation
      // is the core guarantee of the actor-scoped form.
      expect(bRecipients).toHaveLength(2);
      for (const r of bRecipients) {
        expect(r.dismissed_at).toBeNull();
      }
    });

    it('dismisses only the matching local account\'s recipients when filtered by actorAccountId', async () => {
      const accounts = await seedAccounts(3);
      const calendarId = uuidv4();
      const localActor = accounts[0];
      const otherLocalActor = accounts[1];

      const followLocal = await seedActivityWithRecipients(
        {
          verb: 'Follow',
          origin: 'local',
          actor_kind: 'account',
          actor_account_id: localActor,
          object_type: 'calendar',
          object_id: calendarId,
        },
        [accounts[2]],
      );
      const followOther = await seedActivityWithRecipients(
        {
          verb: 'Follow',
          origin: 'local',
          actor_kind: 'account',
          actor_account_id: otherLocalActor,
          object_type: 'calendar',
          object_id: calendarId,
        },
        [accounts[2]],
      );

      await service.dismissForObject({
        objectType: 'calendar',
        objectId: calendarId,
        verbs: ['Follow'],
        actorAccountId: localActor,
      });

      const localRecipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: followLocal.activity.id },
      });
      const otherRecipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: followOther.activity.id },
      });

      expect(localRecipients[0].dismissed_at).not.toBeNull();
      expect(otherRecipients[0].dismissed_at).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Idempotency
  // ---------------------------------------------------------------------------

  describe('idempotency', () => {
    it('second call does not overwrite first run\'s dismissed_at timestamps', async () => {
      const [account] = await seedAccounts(1);
      const reportId = uuidv4();

      const { activity } = await seedActivityWithRecipients(
        {
          verb: 'Flag',
          origin: 'local',
          actor_kind: 'anonymous',
          object_type: 'report',
          object_id: reportId,
        },
        [account],
      );

      await service.dismissForObject({
        objectType: 'report',
        objectId: reportId,
      });

      // Capture the dismissed_at after the first call.
      const afterFirst = await NotificationRecipientEntity.findOne({
        where: { notification_activity_id: activity.id },
      });
      expect(afterFirst!.dismissed_at).not.toBeNull();
      const firstTimestamp = afterFirst!.dismissed_at!.getTime();

      // Sleep enough for the wall clock to advance past the previous tick,
      // then re-issue the dismissal. A correct implementation filters on
      // `WHERE dismissed_at IS NULL` so the second call is a no-op; an
      // incorrect implementation would refresh the timestamp.
      await new Promise((resolve) => setTimeout(resolve, 20));

      await service.dismissForObject({
        objectType: 'report',
        objectId: reportId,
      });

      const afterSecond = await NotificationRecipientEntity.findOne({
        where: { notification_activity_id: activity.id },
      });
      expect(afterSecond!.dismissed_at).not.toBeNull();
      expect(afterSecond!.dismissed_at!.getTime()).toBe(firstTimestamp);
    });
  });

  // ---------------------------------------------------------------------------
  // Flag actor-filter no-op
  // ---------------------------------------------------------------------------

  describe('Flag actor-filter no-op', () => {
    it('actor filter against a Flag activity dismisses nothing (NULL identity columns cannot match)', async () => {
      const [account] = await seedAccounts(1);
      const reportId = uuidv4();

      // Flag rows always have NULL actor_account_id and NULL actor_uri
      // per the anonymization policy. An actor filter cannot match.
      const { activity } = await seedActivityWithRecipients(
        {
          verb: 'Flag',
          origin: 'federated',
          actor_kind: 'anonymous',
          actor_account_id: null,
          actor_uri: null,
          object_type: 'report',
          object_id: reportId,
        },
        [account],
      );

      await service.dismissForObject({
        objectType: 'report',
        objectId: reportId,
        verbs: ['Flag'],
        actorUri: 'https://anyone.example/users/whoever',
      });

      const recipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: activity.id },
      });
      // Untouched: Flag's NULL actor_uri cannot equal the filter value.
      expect(recipients[0].dismissed_at).toBeNull();
    });

    it('actor-account filter against a Flag activity dismisses nothing', async () => {
      const [account] = await seedAccounts(1);
      const reportId = uuidv4();

      const { activity } = await seedActivityWithRecipients(
        {
          verb: 'Flag',
          origin: 'local',
          actor_kind: 'anonymous',
          actor_account_id: null,
          actor_uri: null,
          object_type: 'report',
          object_id: reportId,
        },
        [account],
      );

      await service.dismissForObject({
        objectType: 'report',
        objectId: reportId,
        verbs: ['Flag'],
        actorAccountId: account,
      });

      const recipients = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: activity.id },
      });
      expect(recipients[0].dismissed_at).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Dual-actor-filter throw — programming-error contract enforced end-to-end
  // ---------------------------------------------------------------------------

  describe('dual-actor-filter throw (programming-error contract)', () => {
    it('rejects when both actorAccountId and actorUri are set and does NOT change any recipient row', async () => {
      // The dual-actor-filter throw contract is part of
      // the service's documented invariants. Verifying it at integration
      // layer (real DB, real call chain) closes the loop: the throw must
      // precede any DB write so an invalid call cannot half-dismiss rows.
      const [account] = await seedAccounts(1);
      const eventId = uuidv4();

      const { activity } = await seedActivityWithRecipients(
        {
          verb: 'Announce',
          origin: 'federated',
          actor_kind: 'remote_actor',
          actor_uri: 'https://remote.example/users/alice',
          object_type: 'event',
          object_id: eventId,
        },
        [account],
      );
      // Sanity — row exists and is open before the bad call. Refetch
      // from the DB so we see the persisted NULL (the create-returned
      // instance has `dismissed_at` undefined until reloaded).
      const beforeRows = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: activity.id },
      });
      expect(beforeRows).toHaveLength(1);
      expect(beforeRows[0].dismissed_at).toBeNull();

      await expect(
        service.dismissForObject({
          objectType: 'event',
          objectId: eventId,
          actorAccountId: uuidv4(),
          actorUri: 'https://example.com/actor',
        }),
      ).rejects.toThrow(/at most one of actorAccountId.*actorUri/i);

      // No recipient row was touched — the throw fired before any DB write.
      const after = await NotificationRecipientEntity.findAll({
        where: { notification_activity_id: activity.id },
      });
      expect(after).toHaveLength(1);
      expect(after[0].dismissed_at).toBeNull();
    });
  });
});
