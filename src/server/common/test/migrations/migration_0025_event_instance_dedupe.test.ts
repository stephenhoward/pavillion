import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sequelize, DataTypes, QueryTypes } from 'sequelize';
import migration from '../../../../../migrations/0025_add_event_instance_unique_index';

/**
 * Migration 0025 must collapse pre-existing race-condition duplicates on
 * (event_id, start_time) before adding its unique index. Without this, any
 * deployment that ran before the migration — and accumulated duplicate
 * instance rows from concurrent materialization — fails the unique index
 * creation and leaves the app container unhealthy on deploy.
 */
describe('Migration 0025: event_instance dedupe + unique index', () => {
  let sequelize: Sequelize;

  beforeEach(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    });

    // Minimal event_instance table mirroring production columns relevant to
    // this migration. We don't need FK targets since the dedup logic only
    // looks at id, event_id, and start_time.
    await sequelize.getQueryInterface().createTable('event_instance', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      event_id: { type: DataTypes.UUID, allowNull: true },
      calendar_id: { type: DataTypes.UUID, allowNull: true },
      start_time: { type: DataTypes.DATE, allowNull: true },
      end_time: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
  });

  afterEach(async () => {
    await sequelize.close();
  });

  async function insertRow(row: {
    id: string;
    event_id: string | null;
    start_time: string | null;
    end_time?: string | null;
  }) {
    const now = new Date().toISOString();
    await sequelize.query(
      `INSERT INTO event_instance (id, event_id, start_time, end_time, "createdAt", "updatedAt")
       VALUES (:id, :event_id, :start_time, :end_time, :now, :now)`,
      {
        replacements: {
          id: row.id,
          event_id: row.event_id,
          start_time: row.start_time,
          end_time: row.end_time ?? null,
          now,
        },
        type: QueryTypes.INSERT,
      },
    );
  }

  async function countRows(): Promise<number> {
    const [result] = await sequelize.query(
      'SELECT COUNT(*) AS cnt FROM event_instance',
      { type: QueryTypes.SELECT },
    ) as unknown as Array<{ cnt: number }>;
    return Number(result.cnt);
  }

  async function uniqueIndexExists(): Promise<boolean> {
    const indexes = await sequelize.getQueryInterface().showIndex('event_instance') as Array<{
      name: string;
      unique?: boolean;
    }>;
    return indexes.some((ix) => ix.name === 'idx_event_instance_event_id_start_time_unique');
  }

  it('collapses race-condition duplicates and adds the unique index', async () => {
    // Two pairs of duplicates and one unique row, mirroring what was
    // observed on staging (concurrent materialization wrote two rows with
    // identical event_id/start_time/end_time milliseconds apart).
    await insertRow({ id: '1858fe55-c70d-4e48-afab-256af8c2c2df', event_id: '333917a9-bf73-4d98-a0c5-298e9abc3671', start_time: '2026-04-08T22:00:00Z', end_time: '2026-04-09T00:00:00Z' });
    await insertRow({ id: '96dab635-9370-4fa3-909b-1175349b9c54', event_id: '333917a9-bf73-4d98-a0c5-298e9abc3671', start_time: '2026-04-08T22:00:00Z', end_time: '2026-04-09T00:00:00Z' });
    await insertRow({ id: '647b28e8-12da-46bd-b56d-68b1af512912', event_id: '645bbe10-b841-43c3-a2c5-a87d35c74a1f', start_time: '2026-06-06T17:00:00Z', end_time: '2026-06-06T21:00:00Z' });
    await insertRow({ id: 'cc2ec2c8-0b57-49ad-aac4-2153b37ae7a3', event_id: '645bbe10-b841-43c3-a2c5-a87d35c74a1f', start_time: '2026-06-06T17:00:00Z', end_time: '2026-06-06T21:00:00Z' });
    await insertRow({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', event_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', start_time: '2026-07-01T12:00:00Z' });

    expect(await countRows()).toBe(5);

    await migration.up({ context: sequelize });

    // 2 deduped pairs + 1 unique row = 3 rows. The lowest id per group
    // survives; the others are dropped.
    expect(await countRows()).toBe(3);
    expect(await uniqueIndexExists()).toBe(true);

    const survivors = await sequelize.query(
      'SELECT id FROM event_instance ORDER BY id',
      { type: QueryTypes.SELECT },
    ) as Array<{ id: string }>;
    const surviving = survivors.map((r) => r.id);
    expect(surviving).toContain('1858fe55-c70d-4e48-afab-256af8c2c2df');
    expect(surviving).toContain('647b28e8-12da-46bd-b56d-68b1af512912');
    expect(surviving).toContain('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });

  it('is a no-op when there are no duplicates', async () => {
    await insertRow({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', event_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', start_time: '2026-07-01T12:00:00Z' });
    await insertRow({ id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', event_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', start_time: '2026-07-02T12:00:00Z' });

    await migration.up({ context: sequelize });

    expect(await countRows()).toBe(2);
    expect(await uniqueIndexExists()).toBe(true);
  });

  it('leaves rows with NULL event_id or start_time alone', async () => {
    // Duplicates by NULL are not unique-constrained (NULL ≠ NULL) and the
    // dedup step explicitly skips them so the data is preserved as-is.
    await insertRow({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', event_id: null, start_time: null });
    await insertRow({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', event_id: null, start_time: null });
    await insertRow({ id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', event_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', start_time: null });

    await migration.up({ context: sequelize });

    expect(await countRows()).toBe(3);
    expect(await uniqueIndexExists()).toBe(true);
  });

  it('is idempotent on a second run', async () => {
    await insertRow({ id: '1858fe55-c70d-4e48-afab-256af8c2c2df', event_id: '333917a9-bf73-4d98-a0c5-298e9abc3671', start_time: '2026-04-08T22:00:00Z' });
    await insertRow({ id: '96dab635-9370-4fa3-909b-1175349b9c54', event_id: '333917a9-bf73-4d98-a0c5-298e9abc3671', start_time: '2026-04-08T22:00:00Z' });

    await migration.up({ context: sequelize });
    await migration.up({ context: sequelize });

    expect(await countRows()).toBe(1);
    expect(await uniqueIndexExists()).toBe(true);
  });

  it('down removes the unique index', async () => {
    await migration.up({ context: sequelize });
    expect(await uniqueIndexExists()).toBe(true);

    await migration.down({ context: sequelize });
    expect(await uniqueIndexExists()).toBe(false);
  });
});
