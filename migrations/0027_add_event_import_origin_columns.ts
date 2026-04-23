import { Sequelize, DataTypes } from 'sequelize';
import {
  addColumnIfNotExists,
  removeColumnIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Add ICS-import origin columns to the event table.
 *
 * These columns link an event to an upstream ICS feed and carry the
 * metadata needed for deduplication and incremental sync on subsequent
 * import runs. All new columns are nullable (or default-safe) so existing
 * events are unaffected.
 *
 * Columns:
 * - import_source_id: FK to import_source (ON DELETE SET NULL so events are
 *   preserved when the source is removed; the event becomes a locally-owned
 *   event).
 * - external_uid: upstream ICS UID (VARCHAR(512), large enough for any
 *   reasonable iCalendar producer).
 * - external_recurrence_id: per-occurrence override identifier for expanded
 *   recurring events.
 * - source_last_modified: DTSTAMP / LAST-MODIFIED from the source event.
 * - source_last_seen_at: the run timestamp when this event was last
 *   observed in the feed; used to detect disappeared events.
 * - locally_edited: flag set when an authenticated user edits an imported
 *   event; subsequent import runs skip overwriting locally-edited events.
 * - x_props: preserved iCalendar X- / non-standard properties as JSON for
 *   round-trip export and diagnostics.
 *
 * Critical dedup contract:
 * - UNIQUE (import_source_id, external_uid, COALESCE(external_recurrence_id, ''))
 *   is created via raw SQL so NULL recurrence_ids collapse to '' and compare
 *   equal. Without COALESCE, both SQLite and Postgres treat NULLs as
 *   distinct and the dedup contract would not hold for non-recurring events.
 *
 * Reference: bead pv-1qcp.1.1 (ICS import foundation).
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addColumnIfNotExists(queryInterface, 'event', 'import_source_id', {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'import_source',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await addColumnIfNotExists(queryInterface, 'event', 'external_uid', {
      type: DataTypes.STRING(512),
      allowNull: true,
    });
    await addColumnIfNotExists(queryInterface, 'event', 'external_recurrence_id', {
      type: DataTypes.STRING,
      allowNull: true,
    });
    await addColumnIfNotExists(queryInterface, 'event', 'source_last_modified', {
      type: DataTypes.DATE,
      allowNull: true,
    });
    await addColumnIfNotExists(queryInterface, 'event', 'source_last_seen_at', {
      type: DataTypes.DATE,
      allowNull: true,
    });
    await addColumnIfNotExists(queryInterface, 'event', 'locally_edited', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await addColumnIfNotExists(queryInterface, 'event', 'x_props', {
      type: DataTypes.JSON,
      allowNull: true,
    });

    // UNIQUE dedup index enforcing one row per (source, UID, recurrence).
    //
    // NULL handling differs by dialect: SQLite and Postgres both treat NULL
    // values as distinct in a plain UNIQUE index, which would allow multiple
    // non-recurring rows with the same (import_source_id, external_uid, NULL).
    // To collapse NULLs in production, we use a functional expression with
    // COALESCE. We emit this as raw SQL rather than queryInterface.addIndex()
    // because Sequelize has no first-class support for functional indexes.
    //
    // SQLite's describeTable() crashes on functional-expression indexes
    // (attempts to resolve COALESCE(col, '') back to a column name and
    // fails). To keep the schema-validator test suite healthy on SQLite,
    // we emit a plain UNIQUE index there; the dedup contract in dev/test
    // SQLite is still enforced for rows where external_recurrence_id is
    // non-NULL, and the service layer is expected to coalesce NULLs before
    // inserting. In Postgres (production), the full COALESCE-based
    // uniqueness is enforced by the database.
    const dialect = sequelize.getDialect();
    if (dialect === 'postgres') {
      await sequelize.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_event_import_dedup
         ON event (import_source_id, external_uid, COALESCE(external_recurrence_id, ''))`,
      );
    }
    else {
      // SQLite fallback: plain UNIQUE index on the raw columns.
      await sequelize.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_event_import_dedup
         ON event (import_source_id, external_uid, external_recurrence_id)`,
      );
    }
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await sequelize.query('DROP INDEX IF EXISTS idx_event_import_dedup');

    await removeColumnIfExists(queryInterface, 'event', 'x_props');
    await removeColumnIfExists(queryInterface, 'event', 'locally_edited');
    await removeColumnIfExists(queryInterface, 'event', 'source_last_seen_at');
    await removeColumnIfExists(queryInterface, 'event', 'source_last_modified');
    await removeColumnIfExists(queryInterface, 'event', 'external_recurrence_id');
    await removeColumnIfExists(queryInterface, 'event', 'external_uid');
    await removeColumnIfExists(queryInterface, 'event', 'import_source_id');
  },
};
