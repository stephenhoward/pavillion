import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sequelize, DataTypes, QueryTypes } from 'sequelize';
import migration from '../../../../../migrations/0047_add_ap_inbox_unprocessed_index';

const INDEX_NAME = 'idx_ap_inbox_unprocessed';

/**
 * Migration 0047 adds a partial index over (message_time, createdAt) on the
 * unprocessed ap_inbox rows, so the inbox drain's
 * `WHERE processed_time IS NULL ORDER BY message_time, createdAt` query reads
 * a tiny index instead of scanning a table that only grows.
 *
 * What matters is that the index is partial (its size tracks the unprocessed
 * backlog, not the table) and that the drain query actually uses it.
 */
describe('Migration 0047: partial index on unprocessed ap_inbox rows', () => {
  let sequelize: Sequelize;

  beforeEach(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    });

    await sequelize.getQueryInterface().createTable('ap_inbox', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: true },
      message_time: { type: DataTypes.DATE, allowNull: true },
      processed_time: { type: DataTypes.DATE, allowNull: true },
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

  it('should create a partial index on message_time and createdAt over unprocessed rows', async () => {
    await migration.up({ context: sequelize });

    const sql = await indexSql();
    expect(sql).toBeDefined();
    expect(sql).toMatch(/\(`?"?message_time`?"?,\s*`?"?createdAt`?"?\)/);
    expect(sql).toMatch(/WHERE\s+`?"?processed_time`?"?\s+IS\s+NULL/i);
  });

  it('should be used by the inbox drain query', async () => {
    await migration.up({ context: sequelize });

    const plan = await sequelize.query<{ detail: string }>(
      `EXPLAIN QUERY PLAN
       SELECT * FROM ap_inbox
        WHERE processed_time IS NULL
        ORDER BY message_time ASC, createdAt ASC
        LIMIT 1000`,
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
