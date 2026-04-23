import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes } from 'sequelize';
import path from 'path';
import { randomUUID } from 'crypto';

import { runMigrations } from '@/server/common/migrations/runner';

/**
 * Integration tests for bead pv-1qcp.1.1 (ICS import foundation schema).
 *
 * Validates the three foundation migrations end-to-end on fresh SQLite:
 * - 0026_create_import_source.ts
 * - 0027_create_import_run.ts
 * - 0028_add_event_import_origin_columns.ts
 *
 * Specifically covers the acceptance criteria:
 * - Migration up/down works
 * - UNIQUE dedup index is created and enforced for non-null recurrence ids
 * - Cascade semantics: delete import_source → import_runs are deleted,
 *   events are preserved with NULL import_source_id
 * - Existing events (created before the import column backfill) remain
 *   functional with default values on the new columns
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

  async function seedEvent(calendarId: string, importSourceId: string | null, externalUid: string | null, recurrenceId: string | null): Promise<string> {
    const id = randomUUID();
    await sequelize.query(
      `INSERT INTO event
         (id, calendar_id, import_source_id, external_uid, external_recurrence_id,
          media_focal_point_x, media_focal_point_y, media_zoom, locally_edited,
          createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, 0.5, 0.5, 1.0, 0, datetime('now'), datetime('now'))`,
      { replacements: [id, calendarId, importSourceId, externalUid, recurrenceId] },
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

    it('adds origin columns to event table', async () => {
      const qi = sequelize.getQueryInterface();
      const desc = await qi.describeTable('event') as Record<string, unknown>;

      expect(desc).toHaveProperty('import_source_id');
      expect(desc).toHaveProperty('external_uid');
      expect(desc).toHaveProperty('external_recurrence_id');
      expect(desc).toHaveProperty('source_last_modified');
      expect(desc).toHaveProperty('source_last_seen_at');
      expect(desc).toHaveProperty('locally_edited');
      expect(desc).toHaveProperty('x_props');
    });

    it('creates the UNIQUE dedup index on event', async () => {
      const indexes = await sequelize.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'event'`,
        { type: QueryTypes.SELECT },
      );

      const names = indexes.map((i) => i.name);
      expect(names).toContain('idx_event_import_dedup');
    });
  });

  describe('UNIQUE dedup index enforcement', () => {
    it('rejects duplicate (import_source_id, external_uid, external_recurrence_id) tuples', async () => {
      const calendarId = await seedCalendar();
      const sourceId = await seedImportSource(calendarId);

      await seedEvent(calendarId, sourceId, 'event-uid-1@example.test', 'rec-1');

      // Sequelize wraps SQLite's UNIQUE constraint violation as a
      // SequelizeUniqueConstraintError ("Validation error"). Matching the
      // error class keeps the test independent of Sequelize's message
      // formatting.
      await expect(
        seedEvent(calendarId, sourceId, 'event-uid-1@example.test', 'rec-1'),
      ).rejects.toThrow(/validation|UNIQUE/i);
    });

    it('allows distinct external_uid values for the same source', async () => {
      const calendarId = await seedCalendar();
      const sourceId = await seedImportSource(calendarId);

      await seedEvent(calendarId, sourceId, 'event-uid-1@example.test', null);
      // Different uid → allowed
      await seedEvent(calendarId, sourceId, 'event-uid-2@example.test', null);

      const [row] = await sequelize.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM event WHERE import_source_id = ?`,
        { replacements: [sourceId], type: QueryTypes.SELECT },
      );
      expect(row.count).toBe(2);
    });

    it('allows the same external_uid across different import sources', async () => {
      const calendarId = await seedCalendar();
      const sourceA = await seedImportSource(calendarId, 'https://a.example.test/feed.ics');
      const sourceB = await seedImportSource(calendarId, 'https://b.example.test/feed.ics');

      await seedEvent(calendarId, sourceA, 'shared-uid@example.test', null);
      await seedEvent(calendarId, sourceB, 'shared-uid@example.test', null);

      const [row] = await sequelize.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM event WHERE external_uid = 'shared-uid@example.test'`,
        { type: QueryTypes.SELECT },
      );
      expect(row.count).toBe(2);
    });
  });

  describe('Cascade semantics', () => {
    it('cascades delete of import_source → import_runs are deleted; events are preserved with NULL import_source_id', async () => {
      const calendarId = await seedCalendar();
      const sourceId = await seedImportSource(calendarId);
      const eventId = await seedEvent(calendarId, sourceId, 'event-uid-1@example.test', null);

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

      // import_run rows should be gone (CASCADE).
      const [runRow] = await sequelize.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM import_run WHERE import_source_id = ?`,
        { replacements: [sourceId], type: QueryTypes.SELECT },
      );
      expect(runRow.count).toBe(0);

      // event row should remain with import_source_id nulled out (SET NULL).
      const [eventRow] = await sequelize.query<{ id: string; import_source_id: string | null }>(
        `SELECT id, import_source_id FROM event WHERE id = ?`,
        { replacements: [eventId], type: QueryTypes.SELECT },
      );
      expect(eventRow).toBeDefined();
      expect(eventRow.id).toBe(eventId);
      expect(eventRow.import_source_id).toBeNull();
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
    it('allows events with no import metadata to continue functioning', async () => {
      const calendarId = await seedCalendar();

      // Event with no import linkage at all — representing a pre-existing
      // locally-authored event.
      const eventId = await seedEvent(calendarId, null, null, null);

      const [row] = await sequelize.query<{
        id: string;
        import_source_id: string | null;
        external_uid: string | null;
        external_recurrence_id: string | null;
        locally_edited: number;
      }>(
        `SELECT id, import_source_id, external_uid, external_recurrence_id, locally_edited
         FROM event WHERE id = ?`,
        { replacements: [eventId], type: QueryTypes.SELECT },
      );

      expect(row.id).toBe(eventId);
      expect(row.import_source_id).toBeNull();
      expect(row.external_uid).toBeNull();
      expect(row.external_recurrence_id).toBeNull();
      // locally_edited defaults to FALSE.
      expect(Boolean(row.locally_edited)).toBe(false);
    });
  });

  describe('Reversibility', () => {
    it('rolls back cleanly: down removes tables and columns', async () => {
      // Run each down migration in reverse order.
      const m0028 = (await import(path.join(migrationsDir, '0028_add_event_import_origin_columns.ts'))).default;
      const m0027 = (await import(path.join(migrationsDir, '0027_create_import_run.ts'))).default;
      const m0026 = (await import(path.join(migrationsDir, '0026_create_import_source.ts'))).default;

      await m0028.down({ context: sequelize });
      await m0027.down({ context: sequelize });
      await m0026.down({ context: sequelize });

      const qi = sequelize.getQueryInterface();
      const tables = (await qi.showAllTables()) as string[];
      expect(tables).not.toContain('import_source');
      expect(tables).not.toContain('import_run');

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
