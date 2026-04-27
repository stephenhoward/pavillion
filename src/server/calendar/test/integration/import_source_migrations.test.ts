import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes } from 'sequelize';
import path from 'path';
import { randomUUID } from 'crypto';

import { runMigrations } from '@/server/common/migrations/runner';

/**
 * Integration tests for bead pv-1qcp.1.1 (ICS import foundation schema),
 * updated by pv-picz.6 to reflect the sibling-table refactor.
 *
 * Validates the three foundation migrations end-to-end on fresh SQLite:
 * - 0026_create_import_source.ts
 * - 0027_create_import_run.ts
 * - 0028_create_event_import_origin.ts (sibling table, replaces the earlier
 *   inline-columns design that added origin columns directly to event)
 *
 * Specifically covers the acceptance criteria:
 * - Migration up/down works
 * - event table has NONE of the seven origin columns (they moved out to
 *   the sibling table)
 * - event_import_origin table exists with expected columns, the two FKs
 *   (both CASCADE), secondary index on import_source_id, and a dialect-
 *   appropriate dedup UNIQUE index
 * - UNIQUE dedup index is created and enforced for non-null recurrence ids
 * - Cascade semantics: delete import_source → import_run rows are deleted
 *   AND event_import_origin rows are deleted, but event rows are preserved
 *   intact (user-observable semantic change from the prior SET NULL design)
 */
describe('ICS import foundation migrations', () => {
  let sequelize: Sequelize;
  const migrationsDir = path.join(process.cwd(), 'migrations');

  beforeEach(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    });
    // SQLite requires PRAGMA to enforce foreign key constraints including
    // ON DELETE CASCADE / SET NULL. Without this PRAGMA the cascade checks
    // below would be no-ops.
    await sequelize.query('PRAGMA foreign_keys = ON');

    const result = await runMigrations(sequelize, migrationsDir);
    expect(result.success).toBe(true);
  });

  afterEach(async () => {
    await sequelize.close();
  });

  async function seedCalendar(): Promise<string> {
    const accountId = randomUUID();
    const calendarId = randomUUID();

    // Note: account and calendar tables retain the legacy camelCase
    // createdAt/updatedAt column names from the initial migration; only a
    // subset of tables were renamed in 0008_fix_timestamp_column_names.
    // The event table likewise still uses createdAt/updatedAt.
    await sequelize.query(
      `INSERT INTO account (id, username, email, createdAt, updatedAt)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
      { replacements: [accountId, `user-${accountId.slice(0, 8)}`, `${accountId.slice(0, 8)}@example.test`] },
    );
    await sequelize.query(
      `INSERT INTO calendar (id, url_name, languages, createdAt, updatedAt)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
      { replacements: [calendarId, `cal-${calendarId.slice(0, 8)}`, 'en'] },
    );

    return calendarId;
  }

  async function seedImportSource(calendarId: string, url = 'https://example.test/feed.ics'): Promise<string> {
    const id = randomUUID();
    await sequelize.query(
      `INSERT INTO import_source
         (id, calendar_id, url, enabled, verification_state, created_at, updated_at)
       VALUES (?, ?, ?, 1, 'unverified', datetime('now'), datetime('now'))`,
      { replacements: [id, calendarId, url] },
    );
    return id;
  }

  async function seedEvent(calendarId: string): Promise<string> {
    const id = randomUUID();
    await sequelize.query(
      `INSERT INTO event
         (id, calendar_id,
          media_focal_point_x, media_focal_point_y, media_zoom,
          createdAt, updatedAt)
       VALUES (?, ?, 0.5, 0.5, 1.0, datetime('now'), datetime('now'))`,
      { replacements: [id, calendarId] },
    );
    return id;
  }

  async function seedEventImportOrigin(
    eventId: string,
    importSourceId: string,
    externalUid: string,
    recurrenceId: string | null,
  ): Promise<string> {
    const id = randomUUID();
    await sequelize.query(
      `INSERT INTO event_import_origin
         (id, event_id, import_source_id, external_uid, external_recurrence_id,
          locally_edited, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))`,
      { replacements: [id, eventId, importSourceId, externalUid, recurrenceId] },
    );
    return id;
  }

  describe('Schema creation', () => {
    it('creates the import_source table with required columns', async () => {
      const qi = sequelize.getQueryInterface();
      const desc = await qi.describeTable('import_source') as Record<string, unknown>;

      expect(desc).toHaveProperty('id');
      expect(desc).toHaveProperty('calendar_id');
      expect(desc).toHaveProperty('url');
      expect(desc).toHaveProperty('enabled');
      expect(desc).toHaveProperty('verification_type');
      expect(desc).toHaveProperty('verification_state');
      expect(desc).toHaveProperty('verification_token');
      expect(desc).toHaveProperty('verified_at');
      expect(desc).toHaveProperty('verification_expires_at');
      expect(desc).toHaveProperty('etag');
      expect(desc).toHaveProperty('content_hash');
      expect(desc).toHaveProperty('last_fetched_at');
      expect(desc).toHaveProperty('last_status');
    });

    it('creates the import_run table with required columns', async () => {
      const qi = sequelize.getQueryInterface();
      const desc = await qi.describeTable('import_run') as Record<string, unknown>;

      expect(desc).toHaveProperty('id');
      expect(desc).toHaveProperty('import_source_id');
      expect(desc).toHaveProperty('started_at');
      expect(desc).toHaveProperty('finished_at');
      expect(desc).toHaveProperty('outcome');
      expect(desc).toHaveProperty('events_created');
      expect(desc).toHaveProperty('events_updated');
      expect(desc).toHaveProperty('events_skipped_locally_edited');
      expect(desc).toHaveProperty('events_disappeared');
      expect(desc).toHaveProperty('error_message');
    });

    it('does NOT add origin columns to the event table (sibling-table design)', async () => {
      // Post pv-picz: origin provenance lives on event_import_origin, not
      // directly on event. The event row shape stays clean.
      const qi = sequelize.getQueryInterface();
      const desc = await qi.describeTable('event') as Record<string, unknown>;

      expect(desc).not.toHaveProperty('import_source_id');
      expect(desc).not.toHaveProperty('external_uid');
      expect(desc).not.toHaveProperty('external_recurrence_id');
      expect(desc).not.toHaveProperty('source_last_modified');
      expect(desc).not.toHaveProperty('source_last_seen_at');
      expect(desc).not.toHaveProperty('locally_edited');
      expect(desc).not.toHaveProperty('x_props');
    });

    it('creates the event_import_origin sibling table with required columns', async () => {
      const qi = sequelize.getQueryInterface();
      const desc = await qi.describeTable('event_import_origin') as Record<string, unknown>;

      expect(desc).toHaveProperty('id');
      expect(desc).toHaveProperty('event_id');
      expect(desc).toHaveProperty('import_source_id');
      expect(desc).toHaveProperty('external_uid');
      expect(desc).toHaveProperty('external_recurrence_id');
      expect(desc).toHaveProperty('source_last_modified');
      expect(desc).toHaveProperty('source_last_seen_at');
      expect(desc).toHaveProperty('locally_edited');
      expect(desc).toHaveProperty('x_props');
      expect(desc).toHaveProperty('created_at');
      expect(desc).toHaveProperty('updated_at');
    });

    it('creates the UNIQUE dedup index on event_import_origin', async () => {
      // Index moved from the event table to the sibling table. On SQLite
      // this is a plain UNIQUE index on the raw columns (the functional
      // COALESCE-based variant is Postgres-only — see migration 0028).
      const indexes = await sequelize.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'event_import_origin'`,
        { type: QueryTypes.SELECT },
      );

      const names = indexes.map((i) => i.name);
      expect(names).toContain('idx_event_import_dedup');
      // Also the secondary index on import_source_id for per-source sync
      // bulk-load queries.
      expect(names).toContain('idx_event_import_origin_source');
    });
  });

  describe('UNIQUE dedup index enforcement', () => {
    it('rejects duplicate (import_source_id, external_uid, external_recurrence_id) tuples on event_import_origin', async () => {
      const calendarId = await seedCalendar();
      const sourceId = await seedImportSource(calendarId);
      const eventId1 = await seedEvent(calendarId);
      const eventId2 = await seedEvent(calendarId);

      await seedEventImportOrigin(eventId1, sourceId, 'event-uid-1@example.test', 'rec-1');

      // Sequelize wraps SQLite's UNIQUE constraint violation as a
      // SequelizeUniqueConstraintError ("Validation error"). Matching the
      // error class keeps the test independent of Sequelize's message
      // formatting.
      await expect(
        seedEventImportOrigin(eventId2, sourceId, 'event-uid-1@example.test', 'rec-1'),
      ).rejects.toThrow(/validation|UNIQUE/i);
    });

    it('allows distinct external_uid values for the same source', async () => {
      const calendarId = await seedCalendar();
      const sourceId = await seedImportSource(calendarId);
      const eventId1 = await seedEvent(calendarId);
      const eventId2 = await seedEvent(calendarId);

      await seedEventImportOrigin(eventId1, sourceId, 'event-uid-1@example.test', null);
      // Different uid → allowed
      await seedEventImportOrigin(eventId2, sourceId, 'event-uid-2@example.test', null);

      const [row] = await sequelize.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM event_import_origin WHERE import_source_id = ?`,
        { replacements: [sourceId], type: QueryTypes.SELECT },
      );
      expect(row.count).toBe(2);
    });

    it('allows the same external_uid across different import sources', async () => {
      const calendarId = await seedCalendar();
      const sourceA = await seedImportSource(calendarId, 'https://a.example.test/feed.ics');
      const sourceB = await seedImportSource(calendarId, 'https://b.example.test/feed.ics');
      const eventIdA = await seedEvent(calendarId);
      const eventIdB = await seedEvent(calendarId);

      await seedEventImportOrigin(eventIdA, sourceA, 'shared-uid@example.test', null);
      await seedEventImportOrigin(eventIdB, sourceB, 'shared-uid@example.test', null);

      const [row] = await sequelize.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM event_import_origin WHERE external_uid = 'shared-uid@example.test'`,
        { type: QueryTypes.SELECT },
      );
      expect(row.count).toBe(2);
    });
  });

  describe('Cascade semantics', () => {
    it('cascades delete of import_source → import_run AND event_import_origin rows are deleted; event rows are preserved intact', async () => {
      // User-observable semantic change from the pre-picz 0028 design:
      // previously event.import_source_id had ON DELETE SET NULL, so the
      // event survived with the provenance column nulled out. Under the
      // sibling-table design the event_import_origin row is CASCADE-deleted
      // instead, dropping provenance entirely while keeping the event row
      // as a locally-owned event.
      const calendarId = await seedCalendar();
      const sourceId = await seedImportSource(calendarId);
      const eventId = await seedEvent(calendarId);
      const originId = await seedEventImportOrigin(eventId, sourceId, 'event-uid-1@example.test', null);

      // Seed an import_run referencing the source.
      await sequelize.query(
        `INSERT INTO import_run
           (id, import_source_id, started_at, outcome,
            events_created, events_updated, events_skipped_locally_edited, events_disappeared,
            created_at)
         VALUES (?, ?, datetime('now'), 'success', 0, 0, 0, 0, datetime('now'))`,
        { replacements: [randomUUID(), sourceId] },
      );

      // Delete the source.
      await sequelize.query('DELETE FROM import_source WHERE id = ?', { replacements: [sourceId] });

      // import_run rows should be gone (CASCADE on import_source_id).
      const [runRow] = await sequelize.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM import_run WHERE import_source_id = ?`,
        { replacements: [sourceId], type: QueryTypes.SELECT },
      );
      expect(runRow.count).toBe(0);

      // event_import_origin rows should also be gone (CASCADE on
      // import_source_id — see migration 0028).
      const [originRow] = await sequelize.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM event_import_origin WHERE id = ?`,
        { replacements: [originId], type: QueryTypes.SELECT },
      );
      expect(originRow.count).toBe(0);

      // event row is preserved intact — no parent touch. The event
      // table no longer has any origin columns to null out.
      const [eventRow] = await sequelize.query<{ id: string }>(
        `SELECT id FROM event WHERE id = ?`,
        { replacements: [eventId], type: QueryTypes.SELECT },
      );
      expect(eventRow).toBeDefined();
      expect(eventRow.id).toBe(eventId);
    });

    it('cascades delete of event → event_import_origin row is removed', async () => {
      // Second FK on the sibling table: event_id with ON DELETE CASCADE.
      // Deleting an event row takes its origin row with it.
      const calendarId = await seedCalendar();
      const sourceId = await seedImportSource(calendarId);
      const eventId = await seedEvent(calendarId);
      const originId = await seedEventImportOrigin(eventId, sourceId, 'event-uid-cascade@example.test', null);

      await sequelize.query('DELETE FROM event WHERE id = ?', { replacements: [eventId] });

      const [row] = await sequelize.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM event_import_origin WHERE id = ?`,
        { replacements: [originId], type: QueryTypes.SELECT },
      );
      expect(row.count).toBe(0);
    });

    it('cascades delete of calendar → import_source rows are deleted', async () => {
      const calendarId = await seedCalendar();
      const sourceId = await seedImportSource(calendarId);

      await sequelize.query('DELETE FROM calendar WHERE id = ?', { replacements: [calendarId] });

      const [row] = await sequelize.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM import_source WHERE id = ?`,
        { replacements: [sourceId], type: QueryTypes.SELECT },
      );
      expect(row.count).toBe(0);
    });
  });

  describe('Existing events unaffected', () => {
    it('allows events with no import metadata to continue functioning (no origin row required)', async () => {
      // Post-picz: a locally-authored event simply has no corresponding row
      // in event_import_origin. There is no longer any "origin default
      // values on the event row" to assert — the event row has no origin
      // columns at all.
      const calendarId = await seedCalendar();

      const eventId = await seedEvent(calendarId);

      const [row] = await sequelize.query<{ id: string }>(
        `SELECT id FROM event WHERE id = ?`,
        { replacements: [eventId], type: QueryTypes.SELECT },
      );
      expect(row.id).toBe(eventId);

      // No row exists on the sibling table for a locally-authored event.
      const [originRow] = await sequelize.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM event_import_origin WHERE event_id = ?`,
        { replacements: [eventId], type: QueryTypes.SELECT },
      );
      expect(originRow.count).toBe(0);
    });
  });

  describe('verification_type discriminator', () => {
    it('leaves verification_type NULL when an insert omits the column', async () => {
      // Migration 0026 defines verification_type as nullable with no DB
      // default so a freshly created source sits in a "no method chosen yet"
      // state until the verify-ownership wizard records the owner's choice.
      const calendarId = await seedCalendar();
      const sourceId = randomUUID();
      await sequelize.query(
        `INSERT INTO import_source
           (id, calendar_id, url, enabled, verification_state, created_at, updated_at)
         VALUES (?, ?, ?, 1, 'unverified', datetime('now'), datetime('now'))`,
        { replacements: [sourceId, calendarId, 'https://example.test/default-feed.ics'] },
      );

      const [row] = await sequelize.query<{ verification_type: string | null }>(
        `SELECT verification_type FROM import_source WHERE id = ?`,
        { replacements: [sourceId], type: QueryTypes.SELECT },
      );

      expect(row.verification_type).toBeNull();
    });

    it('persists verification_type=rel-me as a valid enum value', async () => {
      // Migration 0026 includes 'rel-me' alongside 'dns-txt' in the
      // discriminator enum. On SQLite the ENUM is not enforced at the DB
      // layer (Sequelize emits no CHECK constraint), so this assertion
      // primarily covers persistence semantics on dev/test. On Postgres
      // the column type rejects any value not in the enum.
      const calendarId = await seedCalendar();
      const sourceId = randomUUID();
      await sequelize.query(
        `INSERT INTO import_source
           (id, calendar_id, url, enabled, verification_type, verification_state,
            created_at, updated_at)
         VALUES (?, ?, ?, 1, 'rel-me', 'unverified', datetime('now'), datetime('now'))`,
        { replacements: [sourceId, calendarId, 'https://example.test/rel-me-feed.ics'] },
      );

      const [row] = await sequelize.query<{ verification_type: string }>(
        `SELECT verification_type FROM import_source WHERE id = ?`,
        { replacements: [sourceId], type: QueryTypes.SELECT },
      );

      expect(row.verification_type).toBe('rel-me');
    });
  });

  describe('Reversibility', () => {
    it('rolls back cleanly: down removes the sibling table and the two import tables', async () => {
      // Run each down migration in reverse order. Post-picz, 0028 drops the
      // event_import_origin sibling table rather than removing columns from
      // the event table.
      const m0028 = (await import(path.join(migrationsDir, '0028_create_event_import_origin.ts'))).default;
      const m0027 = (await import(path.join(migrationsDir, '0027_create_import_run.ts'))).default;
      const m0026 = (await import(path.join(migrationsDir, '0026_create_import_source.ts'))).default;

      await m0028.down({ context: sequelize });
      await m0027.down({ context: sequelize });
      await m0026.down({ context: sequelize });

      const qi = sequelize.getQueryInterface();
      const tables = (await qi.showAllTables()) as string[];
      expect(tables).not.toContain('import_source');
      expect(tables).not.toContain('import_run');
      expect(tables).not.toContain('event_import_origin');

      // Belt-and-braces: after the teardown the event table still has no
      // origin columns (it never had them under the sibling-table design).
      const eventDesc = await qi.describeTable('event') as Record<string, unknown>;
      expect(eventDesc).not.toHaveProperty('import_source_id');
      expect(eventDesc).not.toHaveProperty('external_uid');
      expect(eventDesc).not.toHaveProperty('external_recurrence_id');
      expect(eventDesc).not.toHaveProperty('source_last_modified');
      expect(eventDesc).not.toHaveProperty('source_last_seen_at');
      expect(eventDesc).not.toHaveProperty('locally_edited');
      expect(eventDesc).not.toHaveProperty('x_props');
    });
  });
});
