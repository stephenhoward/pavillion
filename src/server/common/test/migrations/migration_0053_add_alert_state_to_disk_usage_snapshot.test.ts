import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sequelize, DataTypes } from 'sequelize';
import migration from '../../../../../migrations/0053_add_alert_state_to_disk_usage_snapshot';

/**
 * Migration 0053 adds the disk alert's notification state — the level last
 * alerted and when — to disk_usage_snapshot. It is additive: a snapshot row
 * the worker wrote before the deploy keeps its measurement and starts with no
 * alert state, so the first run after the deploy alerts if usage is high.
 */
describe('Migration 0053: add alert state to disk_usage_snapshot', () => {
  let sequelize: Sequelize;

  beforeEach(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    });

    // The pre-0053 disk_usage_snapshot table.
    await sequelize.getQueryInterface().createTable('disk_usage_snapshot', {
      stat_key: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      path: { type: DataTypes.STRING, allowNull: false },
      total_bytes: { type: DataTypes.BIGINT, allowNull: false },
      free_bytes: { type: DataTypes.BIGINT, allowNull: false },
      used_bytes: { type: DataTypes.BIGINT, allowNull: false },
      percentage_used: { type: DataTypes.DOUBLE, allowNull: false },
      written_at: { type: DataTypes.DATE, allowNull: false },
    });
  });

  afterEach(async () => {
    await sequelize.close();
  });

  it('keeps an existing row, with both alert columns null', async () => {
    await sequelize.query(
      `INSERT INTO disk_usage_snapshot
         (stat_key, path, total_bytes, free_bytes, used_bytes, percentage_used, written_at)
       VALUES ('backup_path', '/backups', 1000, 100, 900, 90, '2026-11-20 12:00:00.000 +00:00')`,
    );

    await migration.up({ context: sequelize });

    const [rows] = await sequelize.query('SELECT * FROM disk_usage_snapshot');
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row.percentage_used).toBe(90);
    expect(row.alert_level).toBeNull();
    expect(row.alert_sent_at).toBeNull();

    const description = await sequelize.getQueryInterface().describeTable('disk_usage_snapshot');
    expect(description.alert_level.allowNull).toBe(true);
    expect(description.alert_sent_at.allowNull).toBe(true);
  });

  it('down removes both columns, and is idempotent when they are already absent', async () => {
    await migration.up({ context: sequelize });
    await migration.down({ context: sequelize });
    await migration.down({ context: sequelize });

    const description = await sequelize.getQueryInterface().describeTable('disk_usage_snapshot');
    expect(description.alert_level).toBeUndefined();
    expect(description.alert_sent_at).toBeUndefined();
    expect(description.written_at).toBeDefined();
  });
});
