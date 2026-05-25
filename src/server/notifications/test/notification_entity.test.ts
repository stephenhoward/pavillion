import { describe, it, expect, beforeAll } from 'vitest';
import { UniqueConstraintError } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';

import db from '@/server/common/entity/db';
import { AccountEntity } from '@/server/common/entity/account';
import { NotificationActivityEntity } from '@/server/notifications/entity/notification_activity';
import { NotificationRecipientEntity } from '@/server/notifications/entity/notification_recipient';

/**
 * Round-trip tests for the two-table notifications model. The old
 * single-table NotificationEntity has been removed.
 *
 * Verifies:
 *   - Construction with the full column set (verb/origin/actor_kind/object_type
 *     ENUMs, snapshot fields, nullable identity columns).
 *   - HasMany association on the activity → recipients side.
 *   - FK CASCADE delete: deleting an activity removes its recipients.
 *   - Unique `(notification_activity_id, account_id)` constraint enforcement.
 *
 * Runs against in-memory SQLite via the shared db handle. Foreign-key
 * enforcement is off by default in SQLite, so the cascade test enables it
 * explicitly via PRAGMA (matching the pattern in location_space_entity.test.ts).
 */
describe('Notification activity + recipient entities', () => {
  beforeAll(async () => {
    await db.sync({ force: true });
    if (db.getDialect() === 'sqlite') {
      await db.query('PRAGMA foreign_keys = ON;');
    }
  });

  async function createAccount(): Promise<AccountEntity> {
    return AccountEntity.create({
      id: uuidv4(),
      email: `${uuidv4()}@example.test`,
      username: `user_${uuidv4().slice(0, 8)}`,
    });
  }

  describe('NotificationActivityEntity construction', () => {
    it('persists a Follow activity with the full column set and reads it back', async () => {
      const actorAccount = await createAccount();
      const calendarId = uuidv4();

      const activity = await NotificationActivityEntity.create({
        verb: 'Follow',
        origin: 'federated',
        actor_kind: 'account',
        actor_account_id: actorAccount.id,
        actor_uri: null,
        actor_display_name: 'Alice',
        actor_display_url: 'https://example.test/users/alice',
        object_type: 'calendar',
        object_id: calendarId,
        object_label: 'Test Calendar',
      });

      const fetched = await NotificationActivityEntity.findByPk(activity.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.verb).toBe('Follow');
      expect(fetched!.origin).toBe('federated');
      expect(fetched!.actor_kind).toBe('account');
      expect(fetched!.actor_account_id).toBe(actorAccount.id);
      expect(fetched!.actor_uri).toBeNull();
      expect(fetched!.actor_display_name).toBe('Alice');
      expect(fetched!.actor_display_url).toBe('https://example.test/users/alice');
      expect(fetched!.object_type).toBe('calendar');
      expect(fetched!.object_id).toBe(calendarId);
      expect(fetched!.object_label).toBe('Test Calendar');
      expect(fetched!.created_at).toBeInstanceOf(Date);
    });

    it('persists a Flag activity with NULL actor identity columns and an anonymized display name', async () => {
      // Flag rows are anonymized at insert time
      // anonymization: actor_account_id and actor_uri are always NULL; only
      // the snapshot display name and (optionally) instance URL remain.
      const reportId = uuidv4();

      const activity = await NotificationActivityEntity.create({
        verb: 'Flag',
        origin: 'federated',
        actor_kind: 'anonymous',
        actor_account_id: null,
        actor_uri: null,
        actor_display_name: 'Reporter from example.test',
        actor_display_url: 'https://example.test',
        object_type: 'report',
        object_id: reportId,
        object_label: 'Flagged event title',
      });

      const fetched = await NotificationActivityEntity.findByPk(activity.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.actor_kind).toBe('anonymous');
      expect(fetched!.actor_account_id).toBeNull();
      expect(fetched!.actor_uri).toBeNull();
      expect(fetched!.actor_display_name).toBe('Reporter from example.test');
      expect(fetched!.actor_display_url).toBe('https://example.test');
    });

    it('auto-generates a UUID id when none is supplied', async () => {
      const activity = await NotificationActivityEntity.create({
        verb: 'Announce',
        origin: 'federated',
        actor_kind: 'remote_actor',
        actor_uri: 'https://remote.test/users/bob',
        actor_display_name: 'bob@remote.test',
        actor_display_url: 'https://remote.test/users/bob',
        object_type: 'event',
        object_id: uuidv4(),
        object_label: 'Announced event',
      });

      const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(activity.id).toMatch(UUID_REGEX);
    });
  });

  describe('NotificationRecipientEntity association', () => {
    it('loads recipients via the activity HasMany association', async () => {
      const activity = await NotificationActivityEntity.create({
        verb: 'Follow',
        origin: 'federated',
        actor_kind: 'remote_actor',
        actor_uri: 'https://remote.test/users/carol',
        actor_display_name: 'carol@remote.test',
        actor_display_url: 'https://remote.test/users/carol',
        object_type: 'calendar',
        object_id: uuidv4(),
        object_label: 'A calendar',
      });

      const recipient1Account = await createAccount();
      const recipient2Account = await createAccount();

      await NotificationRecipientEntity.create({
        notification_activity_id: activity.id,
        account_id: recipient1Account.id,
      });
      await NotificationRecipientEntity.create({
        notification_activity_id: activity.id,
        account_id: recipient2Account.id,
      });

      const fetched = await NotificationActivityEntity.findByPk(activity.id, {
        include: [NotificationRecipientEntity],
      });

      expect(fetched).not.toBeNull();
      expect(fetched!.recipients).toHaveLength(2);
      const recipientAccountIds = fetched!.recipients.map(r => r.account_id).sort();
      expect(recipientAccountIds).toEqual([recipient1Account.id, recipient2Account.id].sort());
      // seen_at and dismissed_at default to null until the user acts on the row.
      for (const recipient of fetched!.recipients) {
        expect(recipient.seen_at).toBeNull();
        expect(recipient.dismissed_at).toBeNull();
      }
    });

    it('loads the parent activity via the recipient BelongsTo association', async () => {
      const activity = await NotificationActivityEntity.create({
        verb: 'EditorInvited',
        origin: 'local',
        actor_kind: 'account',
        actor_account_id: (await createAccount()).id,
        actor_display_name: 'Inviting Owner',
        actor_display_url: 'https://local.test/users/owner',
        object_type: 'calendar',
        object_id: uuidv4(),
        object_label: 'Owner-managed calendar',
      });

      const recipientAccount = await createAccount();
      const recipient = await NotificationRecipientEntity.create({
        notification_activity_id: activity.id,
        account_id: recipientAccount.id,
      });

      const fetched = await NotificationRecipientEntity.findByPk(recipient.id, {
        include: [NotificationActivityEntity],
      });

      expect(fetched).not.toBeNull();
      expect(fetched!.activity).toBeDefined();
      expect(fetched!.activity.id).toBe(activity.id);
      expect(fetched!.activity.verb).toBe('EditorInvited');
    });
  });

  describe('cascade delete', () => {
    it('removes recipient rows when their parent activity is deleted', async () => {
      const activity = await NotificationActivityEntity.create({
        verb: 'Announce',
        origin: 'federated',
        actor_kind: 'remote_actor',
        actor_uri: 'https://remote.test/users/dave',
        actor_display_name: 'dave@remote.test',
        actor_display_url: 'https://remote.test/users/dave',
        object_type: 'event',
        object_id: uuidv4(),
        object_label: 'Cascade event',
      });

      const account1 = await createAccount();
      const account2 = await createAccount();

      const recipient1 = await NotificationRecipientEntity.create({
        notification_activity_id: activity.id,
        account_id: account1.id,
      });
      const recipient2 = await NotificationRecipientEntity.create({
        notification_activity_id: activity.id,
        account_id: account2.id,
      });

      await activity.destroy();

      // Cascade is configured at the DB layer (migration 0035) and on the
      // entity FK; with foreign_keys=ON in SQLite both recipient rows should
      // disappear when the parent activity is removed.
      const afterDestroyA = await NotificationRecipientEntity.findByPk(recipient1.id);
      const afterDestroyB = await NotificationRecipientEntity.findByPk(recipient2.id);
      expect(afterDestroyA).toBeNull();
      expect(afterDestroyB).toBeNull();
    });
  });

  describe('unique (notification_activity_id, account_id) constraint', () => {
    it('rejects duplicate (activity, account) recipient rows', async () => {
      const activity = await NotificationActivityEntity.create({
        verb: 'Follow',
        origin: 'federated',
        actor_kind: 'remote_actor',
        actor_uri: 'https://remote.test/users/erin',
        actor_display_name: 'erin@remote.test',
        actor_display_url: 'https://remote.test/users/erin',
        object_type: 'calendar',
        object_id: uuidv4(),
        object_label: 'Unique-constraint calendar',
      });

      const account = await createAccount();

      await NotificationRecipientEntity.create({
        notification_activity_id: activity.id,
        account_id: account.id,
      });

      // Match the typed Sequelize exception rather than its message text:
      // SQLite surfaces the unique-index violation as a `UniqueConstraintError`
      // whose `.message` is the generic "Validation error", so a regex on the
      // message is brittle while the error class is exact.
      await expect(
        NotificationRecipientEntity.create({
          notification_activity_id: activity.id,
          account_id: account.id,
        }),
      ).rejects.toBeInstanceOf(UniqueConstraintError);
    });

    it('allows the same account to receive different activities', async () => {
      const account = await createAccount();

      const activityA = await NotificationActivityEntity.create({
        verb: 'Follow',
        origin: 'federated',
        actor_kind: 'remote_actor',
        actor_uri: 'https://remote.test/users/frank',
        actor_display_name: 'frank@remote.test',
        actor_display_url: 'https://remote.test/users/frank',
        object_type: 'calendar',
        object_id: uuidv4(),
        object_label: 'Calendar A',
      });
      const activityB = await NotificationActivityEntity.create({
        verb: 'Follow',
        origin: 'federated',
        actor_kind: 'remote_actor',
        actor_uri: 'https://remote.test/users/gina',
        actor_display_name: 'gina@remote.test',
        actor_display_url: 'https://remote.test/users/gina',
        object_type: 'calendar',
        object_id: uuidv4(),
        object_label: 'Calendar B',
      });

      const rA = await NotificationRecipientEntity.create({
        notification_activity_id: activityA.id,
        account_id: account.id,
      });
      const rB = await NotificationRecipientEntity.create({
        notification_activity_id: activityB.id,
        account_id: account.id,
      });

      expect(rA.id).not.toBe(rB.id);
      // Assert the recipient rows actually point at the distinct parent
      // activities — guards against accidental same-activity duplication
      // squeaking past the unique-constraint test.
      expect(rA.notification_activity_id).toBe(activityA.id);
      expect(rB.notification_activity_id).toBe(activityB.id);
    });
  });

  // ENUM column validation is enforced at the database layer (Postgres named
  // enum types created by migration 0035). On SQLite — the in-memory dialect
  // used by these tests — Sequelize stores ENUMs as plain TEXT with no CHECK
  // constraint and no ORM-side `validate.isIn` is wired up on the entity, so
  // an invalid value writes through. A SQLite-targeted negative test would
  // need an entity-level validator that does not currently exist here, and
  // adding one is a behavior change outside the scope of pv-89mw.2.2. The
  // Postgres path is covered by the migration's ENUM type definitions and is
  // exercised by the integration test suite that runs against Postgres.
});
