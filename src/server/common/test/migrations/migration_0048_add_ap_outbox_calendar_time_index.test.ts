import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sequelize, DataTypes, QueryTypes } from 'sequelize';
import migration from '../../../../../migrations/0048_add_ap_outbox_calendar_time_index';

const INDEX_NAME = 'idx_ap_outbox_calendar_message_time';

/**
 * Migration 0048 indexes ap_outbox on (calendar_id, message_time), so the
 * public outbox page — one calendar's rows, newest first, below a
 * message_time cursor — reads that calendar's slice of the index instead of
 * scanning every calendar's activities.
 */
describe('Migration 0048: index ap_outbox on calendar_id and message_time', () => {
  let sequelize: Sequelize;

  beforeEach(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    });

    await sequelize.getQueryInterface().createTable('ap_outbox', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: true },
      message_time: { type: DataTypes.DATE, allowNull: true },
      calendar_id: { type: DataTypes.UUID, allowNull: true },
      processed_status: { type: DataTypes.STRING, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
  });

  afterEach(async () => {
    await sequelize.close();
  });

  /**
   * Read the CREATE INDEX statement SQLite recorded for the index.
   *
   * @returns The index DDL, or undefined when the index does not exist
   */
  async function indexSql(): Promise<string | undefined> {
    const rows = await sequelize.query<{ sql: string }>(
      'SELECT sql FROM sqlite_master WHERE type = \'index\' AND name = $name',
      { bind: { name: INDEX_NAME }, type: QueryTypes.SELECT },
    );
    return rows[0]?.sql;
  }

  it('should create an index on calendar_id then message_time', async () => {
    await migration.up({ context: sequelize });

    const sql = await indexSql();
    expect(sql).toBeDefined();
    expect(sql).toMatch(/\(`?"?calendar_id`?"?,\s*`?"?message_time`?"?\)/);
  });

  it('should be used by the outbox page query without a sort', async () => {
    await migration.up({ context: sequelize });

    const plan = await sequelize.query<{ detail: string }>(
      `EXPLAIN QUERY PLAN
       SELECT * FROM ap_outbox
        WHERE calendar_id = 'cal-1'
          AND type IN ('Create', 'Announce', 'Update', 'Delete')
          AND processed_status = 'ok'
          AND message_time < '2026-01-01'
        ORDER BY message_time DESC
        LIMIT 20`,
      { type: QueryTypes.SELECT },
    );

    const details = plan.map((row) => row.detail).join('\n');
    expect(details).toContain(INDEX_NAME);
    expect(details).not.toContain('USE TEMP B-TREE FOR ORDER BY');
  });

  it('should be safe to apply twice', async () => {
    await migration.up({ context: sequelize });
    await migration.up({ context: sequelize });

    expect(await indexSql()).toBeDefined();
  });

  it('should remove the index on rollback', async () => {
    await migration.up({ context: sequelize });
    await migration.down({ context: sequelize });

    expect(await indexSql()).toBeUndefined();
  });
});
