import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sequelize, DataTypes, QueryTypes } from 'sequelize';
import migration from '../../../../../migrations/0051_add_ap_outbox_unprocessed_index';

const INDEX_NAME = 'idx_ap_outbox_unprocessed';

/**
 * Migration 0051 adds a partial index over message_time on the unprocessed
 * ap_outbox rows, so the outbox drain's
 * `WHERE processed_time IS NULL [AND message_time < cutoff] ORDER BY message_time`
 * query reads a tiny index instead of scanning a table that only grows.
 */
describe('Migration 0051: partial index on unprocessed ap_outbox rows', () => {
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
      calendar_id: { type: DataTypes.UUID, allowNull: true },
      message_time: { type: DataTypes.DATE, allowNull: true },
      processed_time: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    // The per-calendar paging index from 0048, so the planner has a rival to
    // choose over.
    await sequelize.getQueryInterface().addIndex('ap_outbox', ['calendar_id', 'message_time'], {
      name: 'idx_ap_outbox_calendar_message_time',
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

  it('should create a partial index on message_time over unprocessed rows', async () => {
    await migration.up({ context: sequelize });

    const sql = await indexSql();
    expect(sql).toBeDefined();
    expect(sql).toMatch(/\(`?"?message_time`?"?\)/);
    expect(sql).toMatch(/WHERE\s+`?"?processed_time`?"?\s+IS\s+NULL/i);
  });

  it('should be used by the outbox drain query, with and without the window', async () => {
    await migration.up({ context: sequelize });

    for (const windowClause of ['', 'AND message_time < \'2026-11-09 00:00:00\'']) {
      const plan = await sequelize.query<{ detail: string }>(
        `EXPLAIN QUERY PLAN
         SELECT * FROM ap_outbox
          WHERE processed_time IS NULL ${windowClause}
          ORDER BY message_time ASC
          LIMIT 1000`,
        { type: QueryTypes.SELECT },
      );

      const details = plan.map((row) => row.detail).join('\n');
      expect(details).toContain(INDEX_NAME);
      expect(details).not.toContain('USE TEMP B-TREE FOR ORDER BY');
    }
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
