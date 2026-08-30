import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sequelize, DataTypes } from 'sequelize';
import migration from '../../../../../migrations/0042_one_open_allocation_per_calendar';

/**
 * Migration 0042 adds a partial unique index enforcing that a calendar has at
 * most one open funding allocation.
 *
 * Two things are worth testing here that the entity-level index declaration
 * cannot reach. The first is the pre-flight guard: rows that already violate
 * the invariant are historical coverage records, and deciding what a calendar
 * was covered by and until when is a product judgement — so the migration must
 * refuse and name them rather than close rows by guesswork, and it must leave
 * the data exactly as it found it. The second is that the index really is
 * partial: closed allocations carry an end_time and any number of them may
 * exist for one calendar, which is what makes a coverage history possible at
 * all.
 */
describe('Migration 0042: one open allocation per calendar', () => {
  let sequelize: Sequelize;

  beforeEach(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    });

    await sequelize.getQueryInterface().createTable('calendar_subscription', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      funding_plan_id: { type: DataTypes.UUID, allowNull: false },
      calendar_id: { type: DataTypes.UUID, allowNull: false },
      amount: { type: DataTypes.INTEGER, allowNull: false },
      end_time: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
    });
  });

  afterEach(async () => {
    await sequelize.close();
  });

  /**
   * Insert one allocation row.
   *
   * @param row - Allocation identity and its end_time
   */
  async function insertAllocation(row: {
    id: string;
    fundingPlanId: string;
    calendarId: string;
    endTime: string | null;
  }): Promise<void> {
    await sequelize.query(
      `INSERT INTO calendar_subscription
         (id, funding_plan_id, calendar_id, amount, end_time, created_at)
       VALUES ($id, $fundingPlanId, $calendarId, 1000000, $endTime, '2026-01-01 00:00:00')`,
      {
        bind: {
          id: row.id,
          fundingPlanId: row.fundingPlanId,
          calendarId: row.calendarId,
          endTime: row.endTime,
        },
      },
    );
  }

  it('should create the index when no calendar holds two open allocations', async () => {
    await insertAllocation({ id: 'a1', fundingPlanId: 'p1', calendarId: 'c1', endTime: null });
    await insertAllocation({ id: 'a2', fundingPlanId: 'p1', calendarId: 'c2', endTime: null });

    await migration.up({ context: sequelize });

    const indexes = await sequelize.getQueryInterface().showIndex('calendar_subscription') as { name: string }[];
    expect(indexes.map((ix) => ix.name)).toContain('idx_calendar_subscription_one_open_per_calendar');
  });

  it('should reject a second open allocation for the same calendar once applied', async () => {
    await insertAllocation({ id: 'a1', fundingPlanId: 'p1', calendarId: 'c1', endTime: null });
    await migration.up({ context: sequelize });

    await expect(
      insertAllocation({ id: 'a2', fundingPlanId: 'p2', calendarId: 'c1', endTime: null }),
    ).rejects.toThrow();
  });

  it('should still allow any number of closed allocations for one calendar', async () => {
    // The coverage history. A calendar moved between plans over time
    // accumulates closed rows, and the index must not stand in the way of that
    // — only of two of them being open at once.
    await insertAllocation({ id: 'a1', fundingPlanId: 'p1', calendarId: 'c1', endTime: '2026-01-05 00:00:00' });
    await insertAllocation({ id: 'a2', fundingPlanId: 'p2', calendarId: 'c1', endTime: '2026-02-05 00:00:00' });

    await migration.up({ context: sequelize });

    await insertAllocation({ id: 'a3', fundingPlanId: 'p3', calendarId: 'c1', endTime: '2026-03-05 00:00:00' });
    await insertAllocation({ id: 'a4', fundingPlanId: 'p4', calendarId: 'c1', endTime: null });

    const rows = await sequelize.query('SELECT id FROM calendar_subscription');
    expect(rows[0]).toHaveLength(4);
  });

  it('should refuse to run and name the calendars when the invariant is already violated', async () => {
    await insertAllocation({ id: 'a1', fundingPlanId: 'p1', calendarId: 'c1', endTime: null });
    await insertAllocation({ id: 'a2', fundingPlanId: 'p2', calendarId: 'c1', endTime: null });

    await expect(migration.up({ context: sequelize })).rejects.toThrow('c1');
  });

  it('should leave the offending rows untouched when it refuses', async () => {
    // Backfilling historical coverage is a data decision, not something a
    // migration may infer — so a refusal must be inert.
    await insertAllocation({ id: 'a1', fundingPlanId: 'p1', calendarId: 'c1', endTime: null });
    await insertAllocation({ id: 'a2', fundingPlanId: 'p2', calendarId: 'c1', endTime: null });

    await expect(migration.up({ context: sequelize })).rejects.toThrow();

    const [rows] = await sequelize.query(
      'SELECT id FROM calendar_subscription WHERE end_time IS NULL ORDER BY id',
    );
    expect(rows).toEqual([{ id: 'a1' }, { id: 'a2' }]);
  });

  it('should remove the index on rollback', async () => {
    await migration.up({ context: sequelize });
    await migration.down({ context: sequelize });

    const indexes = await sequelize.getQueryInterface().showIndex('calendar_subscription') as { name: string }[];
    expect(indexes.map((ix) => ix.name)).not.toContain('idx_calendar_subscription_one_open_per_calendar');
  });
});
