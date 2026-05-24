import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { Sequelize, DataTypes, QueryTypes } from 'sequelize';
import migration from '../../../../../migrations/0035_notifications_activity_model';

/**
 * Migration 0035 wipes the legacy `notification` table and replaces it with
 * the activity/recipient two-table model. The migration is justified by
 * Phase 1 Launch Readiness — pre-production rows have no archival value.
 *
 * Most tests run against in-memory SQLite for schema-shape assertions. SQLite
 * stores Sequelize ENUM columns as plain TEXT, so ENUM-as-CHECK-constraint
 * semantics cannot be verified at the SQLite layer. The Postgres-specific
 * branches (defensive `DROP TYPE IF EXISTS` calls in `up` and explicit enum
 * drops in `down`) are exercised by stubbing `sequelize.getDialect()` to
 * return `'postgres'` and capturing the SQL emitted via `sequelize.query`.
 */
describe('Migration 0035: notifications activity model', () => {
  let sequelize: Sequelize;

  beforeEach(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    });

    // Minimal `account` table — recipient FK targets this. Only id matters.
    await sequelize.getQueryInterface().createTable('account', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });

    // Pre-migration `notification` table (migration 0005 shape) so the up
    // path has something to drop.
    await sequelize.getQueryInterface().createTable('notification', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      account_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'account', key: 'id' },
      },
      type: { type: DataTypes.STRING, allowNull: false },
      calendar_id: { type: DataTypes.UUID, allowNull: false },
      event_id: { type: DataTypes.UUID, allowNull: true },
      actor_name: { type: DataTypes.STRING(256), allowNull: false },
      actor_url: { type: DataTypes.STRING(2048), allowNull: true },
      seen: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: DataTypes.DATE, allowNull: false },
    });
  });

  afterEach(async () => {
    await sequelize.close();
  });

  async function tableExists(name: string): Promise<boolean> {
    const tables = await sequelize.getQueryInterface().showAllTables();
    return tables.includes(name);
  }

  describe('up', () => {
    it('drops the old notification table', async () => {
      expect(await tableExists('notification')).toBe(true);

      await migration.up({ context: sequelize });

      expect(await tableExists('notification')).toBe(false);
    });

    it('creates notification_activity with the design-defined columns', async () => {
      await migration.up({ context: sequelize });

      expect(await tableExists('notification_activity')).toBe(true);

      const desc = await sequelize.getQueryInterface().describeTable('notification_activity');

      // Required columns.
      expect('id' in desc).toBe(true);
      expect('verb' in desc).toBe(true);
      expect('origin' in desc).toBe(true);
      expect('actor_kind' in desc).toBe(true);
      expect('actor_account_id' in desc).toBe(true);
      expect('actor_uri' in desc).toBe(true);
      expect('actor_display_name' in desc).toBe(true);
      expect('actor_display_url' in desc).toBe(true);
      expect('object_type' in desc).toBe(true);
      expect('object_id' in desc).toBe(true);
      expect('object_label' in desc).toBe(true);
      expect('created_at' in desc).toBe(true);

      // Nullability actor_account_id and actor_uri nullable; the
      // snapshot fields and the discriminator columns are NOT NULL.
      expect(desc.actor_account_id.allowNull).toBe(true);
      expect(desc.actor_uri.allowNull).toBe(true);
      expect(desc.actor_display_url.allowNull).toBe(true);
      expect(desc.verb.allowNull).toBe(false);
      expect(desc.origin.allowNull).toBe(false);
      expect(desc.actor_kind.allowNull).toBe(false);
      expect(desc.actor_display_name.allowNull).toBe(false);
      expect(desc.object_type.allowNull).toBe(false);
      expect(desc.object_id.allowNull).toBe(false);
      expect(desc.object_label.allowNull).toBe(false);
    });

    it('creates notification_recipient with the design-defined columns', async () => {
      await migration.up({ context: sequelize });

      expect(await tableExists('notification_recipient')).toBe(true);

      const desc = await sequelize.getQueryInterface().describeTable('notification_recipient');

      expect('id' in desc).toBe(true);
      expect('notification_activity_id' in desc).toBe(true);
      expect('account_id' in desc).toBe(true);
      expect('seen_at' in desc).toBe(true);
      expect('dismissed_at' in desc).toBe(true);
      expect('created_at' in desc).toBe(true);

      // seen_at and dismissed_at are nullable; the FK columns are
      // NOT NULL.
      expect(desc.seen_at.allowNull).toBe(true);
      expect(desc.dismissed_at.allowNull).toBe(true);
      expect(desc.notification_activity_id.allowNull).toBe(false);
      expect(desc.account_id.allowNull).toBe(false);
    });

    it('creates the unique constraint on (notification_activity_id, account_id)', async () => {
      await migration.up({ context: sequelize });

      const indexes = await sequelize
        .getQueryInterface()
        .showIndex('notification_recipient') as Array<{
        name: string;
        unique?: boolean;
        fields?: Array<{ attribute: string }>;
      }>;

      const uniqueIndex = indexes.find(
        (ix) => ix.name === 'unique_notification_recipient_activity_account',
      );
      expect(uniqueIndex).toBeDefined();
      expect(uniqueIndex!.unique).toBe(true);
      // Column composition matters — name alone would silently pass a
      // migration that indexed the wrong columns.
      expect(uniqueIndex!.fields?.map((f) => f.attribute)).toEqual([
        'notification_activity_id',
        'account_id',
      ]);
    });

    it('enforces the unique constraint by rejecting duplicate (activity, account) pairs', async () => {
      // Schema-level guarantee: the unique constraint must actually reject
      // a second row for the same (activity, account) pair. The descriptive
      // check above asserts the index exists; this one asserts it works.
      await migration.up({ context: sequelize });

      const accountId = 'a0000000-0000-0000-0000-000000000001';
      const activityId = 'd0000000-0000-0000-0000-000000000001';
      const now = new Date().toISOString();

      await sequelize.query(
        `INSERT INTO account (id, created_at, updated_at)
         VALUES (:id, :now, :now)`,
        { replacements: { id: accountId, now }, type: QueryTypes.INSERT },
      );
      await sequelize.query(
        `INSERT INTO notification_activity
         (id, verb, origin, actor_kind, actor_display_name, object_type, object_id, object_label, created_at)
         VALUES (:id, 'Follow', 'federated', 'remote_actor', 'alice', 'calendar', :objId, 'My Calendar', :now)`,
        {
          replacements: {
            id: activityId,
            objId: 'c0000000-0000-0000-0000-000000000001',
            now,
          },
          type: QueryTypes.INSERT,
        },
      );

      await sequelize.query(
        `INSERT INTO notification_recipient
         (id, notification_activity_id, account_id, created_at)
         VALUES (:id, :actId, :accId, :now)`,
        {
          replacements: {
            id: 'r0000000-0000-0000-0000-000000000001',
            actId: activityId,
            accId: accountId,
            now,
          },
          type: QueryTypes.INSERT,
        },
      );

      // Second insert with the same (activity, account) pair must fail.
      await expect(
        sequelize.query(
          `INSERT INTO notification_recipient
           (id, notification_activity_id, account_id, created_at)
           VALUES (:id, :actId, :accId, :now)`,
          {
            replacements: {
              id: 'r0000000-0000-0000-0000-000000000002',
              actId: activityId,
              accId: accountId,
              now,
            },
            type: QueryTypes.INSERT,
          },
        ),
      ).rejects.toThrow();
    });

    it('creates supporting indexes on notification_activity', async () => {
      await migration.up({ context: sequelize });

      const indexes = await sequelize
        .getQueryInterface()
        .showIndex('notification_activity') as Array<{
        name: string;
        fields?: Array<{ attribute: string }>;
      }>;

      // dismissForObject query path (recipient → activity join on
      // (object_type, object_id))
      // notifications.
      const objectIndex = indexes.find((ix) => ix.name === 'idx_notification_activity_object');
      expect(objectIndex).toBeDefined();
      expect(objectIndex!.fields?.map((f) => f.attribute)).toEqual([
        'object_type',
        'object_id',
      ]);

      // The per-verb dedup index is intentionally not present in 0035 — its
      // shape depends on the recordActivity dedup tuple finalised in
      // pv-89mw.3.4. Guard against accidental reintroduction.
      expect(
        indexes.some((ix) => ix.name === 'idx_notification_activity_verb_created_at'),
      ).toBe(false);
    });

    it('creates the per-account inbox index on notification_recipient', async () => {
      await migration.up({ context: sequelize });

      const indexes = await sequelize
        .getQueryInterface()
        .showIndex('notification_recipient') as Array<{
        name: string;
        fields?: Array<{ attribute: string }>;
      }>;

      // GET /api/v1/notification scoped to account_id.
      const inboxIndex = indexes.find(
        (ix) => ix.name === 'idx_notification_recipient_account_created_at',
      );
      expect(inboxIndex).toBeDefined();
      expect(inboxIndex!.fields?.map((f) => f.attribute)).toEqual([
        'account_id',
        'created_at',
      ]);
    });

    it('cascades recipient rows when the parent activity is deleted', async () => {
      // FK cascade
      // notification_activity rows and expects recipients to clear with them.
      await migration.up({ context: sequelize });

      const accountId = 'a0000000-0000-0000-0000-000000000002';
      const activityId = 'd0000000-0000-0000-0000-000000000002';
      const recipientId = 'r0000000-0000-0000-0000-000000000003';
      const now = new Date().toISOString();

      await sequelize.query(
        `INSERT INTO account (id, created_at, updated_at) VALUES (:id, :now, :now)`,
        { replacements: { id: accountId, now }, type: QueryTypes.INSERT },
      );
      await sequelize.query(
        `INSERT INTO notification_activity
         (id, verb, origin, actor_kind, actor_display_name, object_type, object_id, object_label, created_at)
         VALUES (:id, 'Announce', 'federated', 'remote_actor', 'bob', 'event', :objId, 'Event title', :now)`,
        {
          replacements: {
            id: activityId,
            objId: 'e0000000-0000-0000-0000-000000000001',
            now,
          },
          type: QueryTypes.INSERT,
        },
      );
      await sequelize.query(
        `INSERT INTO notification_recipient
         (id, notification_activity_id, account_id, created_at)
         VALUES (:id, :actId, :accId, :now)`,
        {
          replacements: { id: recipientId, actId: activityId, accId: accountId, now },
          type: QueryTypes.INSERT,
        },
      );

      // SQLite respects FK cascades only when the pragma is on. Enable it
      // for this assertion so the FK behaviour is exercised end-to-end.
      await sequelize.query('PRAGMA foreign_keys = ON');

      await sequelize.query(
        `DELETE FROM notification_activity WHERE id = :id`,
        { replacements: { id: activityId }, type: QueryTypes.DELETE },
      );

      const remaining = await sequelize.query(
        `SELECT COUNT(*) AS cnt FROM notification_recipient WHERE id = :id`,
        { replacements: { id: recipientId }, type: QueryTypes.SELECT },
      ) as unknown as Array<{ cnt: number }>;
      expect(Number(remaining[0].cnt)).toBe(0);
    });

    it('is idempotent on a second up run', async () => {
      // Matters for `npm run dev` which resets and re-seeds on every
      // backend restart. The migration must survive a re-run against a
      // schema where the new tables already exist and the old one is gone.
      await migration.up({ context: sequelize });
      await migration.up({ context: sequelize });

      expect(await tableExists('notification_activity')).toBe(true);
      expect(await tableExists('notification_recipient')).toBe(true);
      expect(await tableExists('notification')).toBe(false);
    });
  });

  describe('down', () => {
    it('drops the new tables and restores the old notification table', async () => {
      await migration.up({ context: sequelize });
      expect(await tableExists('notification_activity')).toBe(true);
      expect(await tableExists('notification_recipient')).toBe(true);
      expect(await tableExists('notification')).toBe(false);

      await migration.down({ context: sequelize });

      expect(await tableExists('notification_activity')).toBe(false);
      expect(await tableExists('notification_recipient')).toBe(false);
      // The down path recreates the migration 0005 structure so the runner
      // lands on a schema the prior code expects.
      expect(await tableExists('notification')).toBe(true);

      const desc = await sequelize.getQueryInterface().describeTable('notification');
      expect('type' in desc).toBe(true);
      expect('actor_name' in desc).toBe(true);
      expect('actor_url' in desc).toBe(true);
      expect('seen' in desc).toBe(true);

      // Down must also restore migration 0005's indexes so prior code that
      // relies on them retains its query plans.
      const indexes = await sequelize
        .getQueryInterface()
        .showIndex('notification') as Array<{ name: string }>;
      expect(indexes.some((ix) => ix.name === 'notification_account_id_idx')).toBe(true);
      expect(indexes.some((ix) => ix.name === 'notification_created_at_idx')).toBe(true);
    });

    it('is idempotent on a second down run', async () => {
      // AC requires idempotency in both directions. A second down call must
      // not throw and must leave `notification` in place exactly once.
      await migration.up({ context: sequelize });
      await migration.down({ context: sequelize });
      await expect(migration.down({ context: sequelize })).resolves.not.toThrow();

      expect(await tableExists('notification')).toBe(true);
      expect(await tableExists('notification_activity')).toBe(false);
      expect(await tableExists('notification_recipient')).toBe(false);

      // The recreated table should exist exactly once — no duplicates left
      // behind by the second invocation.
      const tables = await sequelize.getQueryInterface().showAllTables();
      const count = tables.filter((t) => t === 'notification').length;
      expect(count).toBe(1);
    });
  });

  describe('Postgres dialect branches', () => {
    // SQLite cannot exercise the dialect-specific enum-drop branches; stub
    // `getDialect()` to `'postgres'` and wrap `sequelize.query` so that the
    // `DROP TYPE` statements are intercepted (SQLite would reject the SQL)
    // while every other query (createTable, dropTable internals, etc.) is
    // passed through to the live in-memory database. This exercises the
    // production idempotency mechanism without needing a real Postgres
    // connection.
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
    });

    afterEach(() => {
      sandbox.restore();
    });

    const expectedEnumDrops = [
      'DROP TYPE IF EXISTS "enum_notification_activity_verb" CASCADE',
      'DROP TYPE IF EXISTS "enum_notification_activity_origin" CASCADE',
      'DROP TYPE IF EXISTS "enum_notification_activity_actor_kind" CASCADE',
      'DROP TYPE IF EXISTS "enum_notification_activity_object_type" CASCADE',
    ];

    /**
     * Wrap `sequelize.query` so DROP TYPE calls are recorded and short-
     * circuited (SQLite cannot execute them), while everything else falls
     * through to the real implementation.
     */
    function installDropTypeInterceptor(): string[] {
      const captured: string[] = [];
      const original = sequelize.query.bind(sequelize);
      sandbox.stub(sequelize, 'query').callsFake(((sql: unknown, ...rest: unknown[]) => {
        if (typeof sql === 'string' && sql.startsWith('DROP TYPE')) {
          captured.push(sql);
          return Promise.resolve([[], undefined as never]);
        }
        return (original as (s: unknown, ...r: unknown[]) => unknown)(sql, ...rest);
      }) as never);
      return captured;
    }

    it('emits four defensive DROP TYPE IF EXISTS calls in up on Postgres', async () => {
      sandbox.stub(sequelize, 'getDialect').returns('postgres');
      const captured = installDropTypeInterceptor();

      await migration.up({ context: sequelize });

      expect(captured).toEqual(expectedEnumDrops);
    });

    it('emits four explicit DROP TYPE IF EXISTS calls in down on Postgres', async () => {
      // Run a real (SQLite-dialect) up first so the new tables exist for
      // down to drop; then switch the reported dialect for the down call.
      await migration.up({ context: sequelize });

      sandbox.stub(sequelize, 'getDialect').returns('postgres');
      const captured = installDropTypeInterceptor();

      await migration.down({ context: sequelize });

      expect(captured).toEqual(expectedEnumDrops);
    });

    it('emits no DROP TYPE calls on the SQLite dialect path (up)', async () => {
      // Guard against regression: the enum-drop branch must remain
      // Postgres-gated, since `DROP TYPE` is not valid SQLite syntax.
      const captured = installDropTypeInterceptor();

      await migration.up({ context: sequelize });

      expect(captured).toEqual([]);
    });
  });
});
