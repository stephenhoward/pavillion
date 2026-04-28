import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sequelize, DataTypes, QueryTypes } from 'sequelize';
import migration from '../../../../../migrations/0029_event_instance_dedupe_for_shared_events';

/**
 * Migration 0029 follows up migration 0025 by collapsing any post-0025
 * duplicate `(event_id, start_time)` rows that the previous shared-event
 * fan-out path could write, and normalizing `event_instance.calendar_id` so
 * it matches `event.calendar_id` for events with a non-null originating
 * calendar (i.e. local events). Remote AP-origin events (event.calendar_id
 * IS NULL) are intentionally left alone — they have no canonical local
 * calendar, so the existing column value is retained.
 *
 * Step 1 collapses duplicates with a preference for the row whose
 * `calendar_id` already matches `event.calendar_id`. When no row matches,
 * the lowest UUID id wins (deterministic tiebreak).
 *
 * Step 2 normalizes the surviving row's `calendar_id` via a correlated
 * subquery (SQLite does not support the `UPDATE … FROM alias` form).
 */
describe('Migration 0029: event_instance dedupe + calendar_id normalize for shared events', () => {
  let sequelize: Sequelize;

  beforeEach(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    });

    // Minimal `event` table — we only need id and calendar_id.
    await sequelize.getQueryInterface().createTable('event', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      calendar_id: { type: DataTypes.UUID, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });

    // Minimal `event_instance` table mirroring production columns relevant
    // to this migration.
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

  async function insertEvent(row: { id: string; calendar_id: string | null }) {
    const now = new Date().toISOString();
    await sequelize.query(
      `INSERT INTO event (id, calendar_id, "createdAt", "updatedAt")
       VALUES (:id, :calendar_id, :now, :now)`,
      {
        replacements: { id: row.id, calendar_id: row.calendar_id, now },
        type: QueryTypes.INSERT,
      },
    );
  }

  async function insertInstance(row: {
    id: string;
    event_id: string | null;
    calendar_id: string | null;
    start_time: string | null;
    end_time?: string | null;
  }) {
    const now = new Date().toISOString();
    await sequelize.query(
      `INSERT INTO event_instance (id, event_id, calendar_id, start_time, end_time, "createdAt", "updatedAt")
       VALUES (:id, :event_id, :calendar_id, :start_time, :end_time, :now, :now)`,
      {
        replacements: {
          id: row.id,
          event_id: row.event_id,
          calendar_id: row.calendar_id,
          start_time: row.start_time,
          end_time: row.end_time ?? null,
          now,
        },
        type: QueryTypes.INSERT,
      },
    );
  }

  async function listInstances(): Promise<Array<{
    id: string;
    event_id: string | null;
    calendar_id: string | null;
    start_time: string | null;
  }>> {
    return await sequelize.query(
      'SELECT id, event_id, calendar_id, start_time FROM event_instance ORDER BY id',
      { type: QueryTypes.SELECT },
    ) as Array<{
      id: string;
      event_id: string | null;
      calendar_id: string | null;
      start_time: string | null;
    }>;
  }

  async function countRows(): Promise<number> {
    const [result] = await sequelize.query(
      'SELECT COUNT(*) AS cnt FROM event_instance',
      { type: QueryTypes.SELECT },
    ) as unknown as Array<{ cnt: number }>;
    return Number(result.cnt);
  }

  it('prefers duplicate row whose calendar_id matches event.calendar_id', async () => {
    // Event lives on Calendar A. Two duplicate instance rows exist for the
    // same (event_id, start_time): one with calendar_id = A (the originating
    // calendar — should win), one with calendar_id = B (the reposting
    // calendar — should be deleted, even though its UUID sorts lower).
    const eventId = 'e0000000-0000-0000-0000-000000000001';
    const calendarA = 'a0000000-0000-0000-0000-00000000000a';
    const calendarB = 'b0000000-0000-0000-0000-00000000000b';
    await insertEvent({ id: eventId, calendar_id: calendarA });

    // Note the row IDs: '11...' sorts before '22...'. Without the
    // calendar-match preference, '11...' would win on the lowest-id tiebreak.
    await insertInstance({
      id: '11111111-1111-1111-1111-111111111111',
      event_id: eventId,
      calendar_id: calendarB,
      start_time: '2026-04-08T22:00:00Z',
    });
    await insertInstance({
      id: '22222222-2222-2222-2222-222222222222',
      event_id: eventId,
      calendar_id: calendarA,
      start_time: '2026-04-08T22:00:00Z',
    });

    await migration.up({ context: sequelize });

    const rows = await listInstances();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('22222222-2222-2222-2222-222222222222');
    expect(rows[0].calendar_id).toBe(calendarA);
  });

  it('falls back to lowest id when no duplicate matches event.calendar_id', async () => {
    // Event lives on Calendar A but neither duplicate row points at A — both
    // point at reposting calendars B and C. The lowest UUID id wins, and
    // step 2 normalizes its calendar_id back to A.
    const eventId = 'e0000000-0000-0000-0000-000000000002';
    const calendarA = 'a0000000-0000-0000-0000-00000000000a';
    const calendarB = 'b0000000-0000-0000-0000-00000000000b';
    const calendarC = 'c0000000-0000-0000-0000-00000000000c';
    await insertEvent({ id: eventId, calendar_id: calendarA });

    await insertInstance({
      id: '11111111-1111-1111-1111-111111111111',
      event_id: eventId,
      calendar_id: calendarB,
      start_time: '2026-04-08T22:00:00Z',
    });
    await insertInstance({
      id: '22222222-2222-2222-2222-222222222222',
      event_id: eventId,
      calendar_id: calendarC,
      start_time: '2026-04-08T22:00:00Z',
    });

    await migration.up({ context: sequelize });

    const rows = await listInstances();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('11111111-1111-1111-1111-111111111111');
    // Step 2 normalized calendar_id from B → A.
    expect(rows[0].calendar_id).toBe(calendarA);
  });

  it('leaves orphan event_instance rows (event_id pointing at a deleted event) untouched', async () => {
    // No matching event row — the LEFT JOIN in step 1 yields a NULL
    // event.calendar_id for the join, so the CASE expression evaluates the
    // same for every row in the partition; lowest-id wins. Step 2 leaves
    // the survivor's calendar_id alone since the EXISTS clause finds no
    // matching event row.
    const orphanEventId = 'e0000000-0000-0000-0000-0000000000ff';
    const calendarX = 'a0000000-0000-0000-0000-00000000000a';

    await insertInstance({
      id: '11111111-1111-1111-1111-111111111111',
      event_id: orphanEventId,
      calendar_id: calendarX,
      start_time: '2026-04-08T22:00:00Z',
    });
    await insertInstance({
      id: '22222222-2222-2222-2222-222222222222',
      event_id: orphanEventId,
      calendar_id: calendarX,
      start_time: '2026-04-08T22:00:00Z',
    });
    // Single non-duplicated orphan row — should survive untouched.
    await insertInstance({
      id: '33333333-3333-3333-3333-333333333333',
      event_id: orphanEventId,
      calendar_id: calendarX,
      start_time: '2026-04-09T22:00:00Z',
    });

    await migration.up({ context: sequelize });

    const rows = await listInstances();
    // Two duplicate rows collapse to one; the standalone orphan stays.
    expect(rows).toHaveLength(2);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('11111111-1111-1111-1111-111111111111');
    expect(ids).toContain('33333333-3333-3333-3333-333333333333');
    // calendar_id retained as-is — orphan rows are not normalized.
    expect(rows.every((r) => r.calendar_id === calendarX)).toBe(true);
  });

  it('retains existing calendar_id when event.calendar_id IS NULL (remote AP-origin events)', async () => {
    // Event has no originating local calendar (e.g. inbound from federation).
    // The instance row's calendar_id should NOT be normalized to NULL — the
    // existing value (whatever the materialization path stored) is retained.
    const eventId = 'e0000000-0000-0000-0000-000000000003';
    const someCalendar = 'a0000000-0000-0000-0000-00000000000a';
    await insertEvent({ id: eventId, calendar_id: null });

    await insertInstance({
      id: '11111111-1111-1111-1111-111111111111',
      event_id: eventId,
      calendar_id: someCalendar,
      start_time: '2026-04-08T22:00:00Z',
    });

    await migration.up({ context: sequelize });

    const rows = await listInstances();
    expect(rows).toHaveLength(1);
    // calendar_id retained — not nulled out, not normalized.
    expect(rows[0].calendar_id).toBe(someCalendar);
  });

  it('is idempotent — second run produces no changes', async () => {
    const eventId = 'e0000000-0000-0000-0000-000000000004';
    const calendarA = 'a0000000-0000-0000-0000-00000000000a';
    const calendarB = 'b0000000-0000-0000-0000-00000000000b';
    await insertEvent({ id: eventId, calendar_id: calendarA });

    await insertInstance({
      id: '11111111-1111-1111-1111-111111111111',
      event_id: eventId,
      calendar_id: calendarB,
      start_time: '2026-04-08T22:00:00Z',
    });
    await insertInstance({
      id: '22222222-2222-2222-2222-222222222222',
      event_id: eventId,
      calendar_id: calendarA,
      start_time: '2026-04-08T22:00:00Z',
    });

    await migration.up({ context: sequelize });
    const afterFirst = await listInstances();

    await migration.up({ context: sequelize });
    const afterSecond = await listInstances();

    expect(afterFirst).toEqual(afterSecond);
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0].calendar_id).toBe(calendarA);
  });

  it('normalizes calendar_id for all kept rows where event.calendar_id is non-null', async () => {
    // Mix of cases. After the migration, every kept event_instance row
    // whose event has a non-null calendar_id must have ei.calendar_id =
    // event.calendar_id.
    const eventA = 'e0000000-0000-0000-0000-00000000000a';
    const eventB = 'e0000000-0000-0000-0000-00000000000b';
    const eventRemote = 'e0000000-0000-0000-0000-0000000000cc';
    const calendarA = 'a0000000-0000-0000-0000-00000000000a';
    const calendarB = 'b0000000-0000-0000-0000-00000000000b';
    const repostingCal = 'c0000000-0000-0000-0000-00000000000c';

    await insertEvent({ id: eventA, calendar_id: calendarA });
    await insertEvent({ id: eventB, calendar_id: calendarB });
    await insertEvent({ id: eventRemote, calendar_id: null });

    // Event A: instance row carries the wrong calendar_id (repost residue)
    // and must be normalized to calendarA in step 2.
    await insertInstance({
      id: '11111111-1111-1111-1111-111111111111',
      event_id: eventA,
      calendar_id: repostingCal,
      start_time: '2026-04-08T22:00:00Z',
    });
    // Event B: instance row already correct — should stay correct.
    await insertInstance({
      id: '22222222-2222-2222-2222-222222222222',
      event_id: eventB,
      calendar_id: calendarB,
      start_time: '2026-04-08T22:00:00Z',
    });
    // Event B: instance row with NULL calendar_id — should be normalized to B.
    await insertInstance({
      id: '33333333-3333-3333-3333-333333333333',
      event_id: eventB,
      calendar_id: null,
      start_time: '2026-04-09T22:00:00Z',
    });
    // Remote-origin event: calendar_id retained as-is (not normalized to NULL).
    await insertInstance({
      id: '44444444-4444-4444-4444-444444444444',
      event_id: eventRemote,
      calendar_id: repostingCal,
      start_time: '2026-04-08T22:00:00Z',
    });

    await migration.up({ context: sequelize });

    expect(await countRows()).toBe(4);

    const rows = await listInstances();
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get('11111111-1111-1111-1111-111111111111')!.calendar_id).toBe(calendarA);
    expect(byId.get('22222222-2222-2222-2222-222222222222')!.calendar_id).toBe(calendarB);
    expect(byId.get('33333333-3333-3333-3333-333333333333')!.calendar_id).toBe(calendarB);
    // Remote-origin event row keeps its existing calendar_id — not
    // overwritten just because event.calendar_id is NULL.
    expect(byId.get('44444444-4444-4444-4444-444444444444')!.calendar_id).toBe(repostingCal);
  });

  it('down is a documented no-op (data deletion cannot be reversed)', async () => {
    // The down migration is intentionally a no-op: collapsed duplicate
    // rows and normalized calendar_id values cannot be restored. This
    // test simply verifies that down() runs without throwing.
    await expect(migration.down({ context: sequelize })).resolves.not.toThrow();
  });
});
