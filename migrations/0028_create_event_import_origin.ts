import { Sequelize, DataTypes } from 'sequelize';
import {
  createTableIfNotExists,
  tableExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Create the event_import_origin sibling table.
 *
 * This table carries the ICS-import provenance metadata for events without
 * polluting the core `event` row shape. Each row links a single `event` to
 * the upstream `import_source` that produced it, and stores the metadata
 * needed for deduplication and incremental sync on subsequent import runs.
 *
 * Design decisions:
 * - Sibling table (not columns on `event`): keeps the event row shape clean
 *   and hides import provenance from the parent domain. The EventEntity
 *   remains unaware of this table (no @HasOne back-reference), matching the
 *   RepostDismissalEntity precedent.
 * - event_id is UNIQUE: at most one origin row per event (one-to-one).
 * - ON DELETE CASCADE on both FKs: the origin row is a dependent fact of
 *   both the event and the import source. If either parent is deleted, the
 *   origin metadata is meaningless and should be cleaned up automatically.
 *   Note: this diverges from the earlier "ON DELETE SET NULL" approach used
 *   when columns lived directly on `event` — in a sibling table, deleting
 *   the origin row simply severs the link and leaves the event as a
 *   locally-owned event.
 *
 * Columns:
 * - event_id: FK to event.id (UNIQUE, CASCADE).
 * - import_source_id: FK to import_source.id (CASCADE).
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
 * Reference: bead pv-picz.1 (refactor ICS-import origin metadata to sibling table).
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await createTableIfNotExists(queryInterface, 'event_import_origin', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      event_id: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
        references: {
          model: 'event',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      import_source_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'import_source',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      external_uid: {
        type: DataTypes.STRING(512),
        allowNull: false,
      },
      external_recurrence_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      source_last_modified: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      source_last_seen_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      locally_edited: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      x_props: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });

    // Secondary index on import_source_id to speed up per-source sync
    // bulk-load eager-join queries.
    await queryInterface.addIndex('event_import_origin', ['import_source_id'], {
      name: 'idx_event_import_origin_source',
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
         ON event_import_origin (import_source_id, external_uid, COALESCE(external_recurrence_id, ''))`,
      );
    }
    else {
      // SQLite fallback: plain UNIQUE index on the raw columns.
      await sequelize.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_event_import_dedup
         ON event_import_origin (import_source_id, external_uid, external_recurrence_id)`,
      );
    }
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await sequelize.query('DROP INDEX IF EXISTS idx_event_import_dedup');

    if (await tableExists(queryInterface, 'event_import_origin')) {
      await queryInterface.dropTable('event_import_origin');
    }
  },
};
