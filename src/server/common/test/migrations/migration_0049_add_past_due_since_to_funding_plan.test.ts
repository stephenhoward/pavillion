import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sequelize, DataTypes } from 'sequelize';
import migration from '../../../../../migrations/0049_add_past_due_since_to_funding_plan';

/**
 * Migration 0049 adds `past_due_since`, the clock a past-due plan's grace
 * period runs from, and backfills it for plans already past due.
 *
 * The backfill is what this test is mostly about. A past-due row left NULL
 * would be read as "grace long over" and lose coverage on deploy, so every
 * past-due row must get a value — the `updatedAt` it was being judged by until
 * now — while rows in any other status stay NULL, and a second run must not
 * move a value already recorded.
 */
describe('Migration 0049: add past_due_since to funding_plan', () => {
  let sequelize: Sequelize;

  beforeEach(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    });

    // Minimal pre-0049 funding_plan: the columns the backfill reads.
    await sequelize.getQueryInterface().createTable('funding_plan', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
  });

  afterEach(async () => {
    await sequelize.close();
  });

  async function insertPlan(id: string, status: string, updatedAt: string): Promise<void> {
    await sequelize.query(
      `INSERT INTO funding_plan (id, status, "createdAt", "updatedAt")
       VALUES ($id, $status, '2026-01-01 00:00:00.000 +00:00', $updatedAt)`,
      { bind: { id, status, updatedAt } },
    );
  }

  async function pastDueSince(id: string): Promise<string | null> {
    const [rows] = await sequelize.query(
      'SELECT past_due_since FROM funding_plan WHERE id = $id',
      { bind: { id } },
    );
    return (rows[0] as { past_due_since: string | null }).past_due_since;
  }

  it('adds a nullable past_due_since column', async () => {
    await migration.up({ context: sequelize });

    const description = await sequelize.getQueryInterface().describeTable('funding_plan');
    expect(description.past_due_since).toBeDefined();
    expect(description.past_due_since.allowNull).toBe(true);
  });

  it('backfills past-due plans from updatedAt and leaves every other status NULL', async () => {
    const lastWrite = '2026-01-07 12:00:00.000 +00:00';
    await insertPlan('00000000-0000-4000-8000-000000000001', 'past_due', lastWrite);
    await insertPlan('00000000-0000-4000-8000-000000000002', 'active', lastWrite);
    await insertPlan('00000000-0000-4000-8000-000000000003', 'suspended', lastWrite);
    await insertPlan('00000000-0000-4000-8000-000000000004', 'cancelled', lastWrite);

    await migration.up({ context: sequelize });

    expect(await pastDueSince('00000000-0000-4000-8000-000000000001')).toBe(lastWrite);
    expect(await pastDueSince('00000000-0000-4000-8000-000000000002')).toBeNull();
    expect(await pastDueSince('00000000-0000-4000-8000-000000000003')).toBeNull();
    expect(await pastDueSince('00000000-0000-4000-8000-000000000004')).toBeNull();
  });

  it('does not move a recorded instant on a second up run', async () => {
    const id = '00000000-0000-4000-8000-000000000005';
    await insertPlan(id, 'past_due', '2026-01-07 12:00:00.000 +00:00');
    await migration.up({ context: sequelize });

    await sequelize.query(
      'UPDATE funding_plan SET "updatedAt" = $later WHERE id = $id',
      { bind: { id, later: '2026-01-14 12:00:00.000 +00:00' } },
    );
    await migration.up({ context: sequelize });

    expect(await pastDueSince(id)).toBe('2026-01-07 12:00:00.000 +00:00');
  });

  it('down removes the column, and is idempotent when it is already absent', async () => {
    await migration.up({ context: sequelize });
    await migration.down({ context: sequelize });
    await migration.down({ context: sequelize });

    const description = await sequelize.getQueryInterface().describeTable('funding_plan');
    expect(description.past_due_since).toBeUndefined();
  });
});
