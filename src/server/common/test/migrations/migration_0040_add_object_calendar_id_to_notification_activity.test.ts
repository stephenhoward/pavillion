import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sequelize, DataTypes, QueryTypes } from 'sequelize';
import migration from '../../../../../migrations/0040_add_object_calendar_id_to_notification_activity';

/**
 * Migration 0040 adds a nullable `object_calendar_id` to
 * `notification_activity` so the write path can persist the owning calendar
 * it already holds.
 *
 * Two guarantees the entity round-trip test cannot reach:
 *   1. Rows written before the column existed survive the migration with
 *      NULL rather than being rewritten or rejected — there is deliberately
 *      no backfill, and a NOT NULL constraint would have broken deploy.
 *   2. The column is genuinely nullable at the DB level, because an admin
 *      reporting a remote event legitimately has no owning calendar.
 */
describe('Migration 0040: add object_calendar_id to notification_activity', () => {
  let sequelize: Sequelize;

  beforeEach(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    });

    // Pre-0040 `notification_activity` shape (migration 0035). SQLite stores
    // ENUM columns as TEXT, which is all this migration needs.
    await sequelize.getQueryInterface().createTable('notification_activity', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      verb: { type: DataTypes.TEXT, allowNull: false },
      origin: { type: DataTypes.TEXT, allowNull: false },
      actor_kind: { type: DataTypes.TEXT, allowNull: false },
      actor_account_id: { type: DataTypes.UUID, allowNull: true },
      actor_uri: { type: DataTypes.TEXT, allowNull: true },
      actor_display_name: { type: DataTypes.TEXT, allowNull: false },
      actor_display_url: { type: DataTypes.TEXT, allowNull: true },
      object_type: { type: DataTypes.TEXT, allowNull: false },
      object_id: { type: DataTypes.UUID, allowNull: false },
      object_label: { type: DataTypes.TEXT, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false },
    });
  });

  afterEach(async () => {
    await sequelize.close();
  });

  async function insertActivity(id: string) {
    const now = new Date().toISOString();
    await sequelize.query(
      `INSERT INTO notification_activity
         (id, verb, origin, actor_kind, actor_display_name,
          object_type, object_id, object_label, created_at)
       VALUES (:id, 'Flag', 'local', 'anonymous', 'Anonymous reporter',
               'report', :objectId, 'Flagged event', :now)`,
      {
        replacements: {
          id,
          objectId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          now,
        },
        type: QueryTypes.INSERT,
      },
    );
  }

  it('adds a nullable object_calendar_id column', async () => {
    await migration.up({ context: sequelize });

    const desc = await sequelize.getQueryInterface().describeTable('notification_activity');
    expect('object_calendar_id' in desc).toBe(true);
    // Nullable is load-bearing, not defensive: reports against remote events
    // own no calendar. The entity declares allowNull: true and the two must
    // agree or the repo-wide migration-validation suite fails.
    expect(desc.object_calendar_id.allowNull).toBe(true);
  });

  it('leaves pre-existing rows at NULL (no backfill)', async () => {
    await insertActivity('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1');

    await migration.up({ context: sequelize });

    const [row] = await sequelize.query(
      'SELECT object_calendar_id FROM notification_activity WHERE id = :id',
      {
        replacements: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1' },
        type: QueryTypes.SELECT,
      },
    ) as Array<{ object_calendar_id: unknown }>;

    expect(row.object_calendar_id).toBeNull();
  });

  it('accepts an explicit NULL on insert after the migration', async () => {
    await migration.up({ context: sequelize });

    const now = new Date().toISOString();
    await sequelize.query(
      `INSERT INTO notification_activity
         (id, verb, origin, actor_kind, actor_display_name,
          object_type, object_id, object_calendar_id, object_label, created_at)
       VALUES (:id, 'Flag', 'local', 'anonymous', 'Anonymous reporter',
               'report', :objectId, NULL, 'Remote event report', :now)`,
      {
        replacements: {
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          objectId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
          now,
        },
        type: QueryTypes.INSERT,
      },
    );

    const [row] = await sequelize.query(
      'SELECT object_calendar_id FROM notification_activity WHERE id = :id',
      {
        replacements: { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
        type: QueryTypes.SELECT,
      },
    ) as Array<{ object_calendar_id: unknown }>;

    expect(row.object_calendar_id).toBeNull();
  });

  it('down removes the object_calendar_id column', async () => {
    await migration.up({ context: sequelize });

    const afterUp = await sequelize.getQueryInterface().describeTable('notification_activity');
    expect('object_calendar_id' in afterUp).toBe(true);

    await migration.down({ context: sequelize });

    const afterDown = await sequelize.getQueryInterface().describeTable('notification_activity');
    expect('object_calendar_id' in afterDown).toBe(false);
  });

  it('is idempotent on a second up run', async () => {
    await migration.up({ context: sequelize });
    await migration.up({ context: sequelize });

    const desc = await sequelize.getQueryInterface().describeTable('notification_activity');
    expect('object_calendar_id' in desc).toBe(true);
  });
});
