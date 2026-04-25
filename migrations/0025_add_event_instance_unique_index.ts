import { Sequelize, QueryTypes } from 'sequelize';
import { addIndexIfNotExists, removeIndexIfExists } from '../src/server/common/migrations/helpers.js';

/**
 * Add a unique compound index on event_instance(event_id, start_time).
 *
 * Context: public event-instance URLs use a minute-precision UTC timestamp
 * slug (`yyyymmdd-hhmm`) rather than the row UUID. The lookup `(event_id,
 * start_time)` must return at most one row. This index also protects the
 * `findOrMaterializeInstanceWithDetails` race where two concurrent requests
 * for the same uncached occurrence could both attempt to insert — the loser
 * catches the unique-violation and re-fetches.
 *
 * The existing non-unique indexes on event_id and start_time remain in
 * place; they are still useful for range scans and single-column lookups.
 *
 * Pre-existing duplicates: any deployment that ran before this migration
 * could already hold race-condition duplicates from the same path the index
 * is meant to prevent. Collapse them to a single row per (event_id,
 * start_time) before adding the unique index, otherwise the index creation
 * fails on existing data. Rows whose event_id or start_time is NULL are not
 * touched — they cannot collide with anything (NULL ≠ NULL in SQL) and the
 * index does not constrain them.
 *
 * Invariant: both columns are `allowNull: true` in the schema but the
 * materialization path always populates them. The uniqueness guarantee
 * therefore relies on the application-level rule that a materialized
 * instance row has non-NULL event_id AND non-NULL start_time. If that
 * invariant is ever relaxed, a follow-up migration should enforce NOT NULL
 * at the DB level before trusting this index for race protection.
 *
 * Reference: docs/superpowers/specs/2026-04-22-instance-timestamp-slug-design.md
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // Collapse pre-existing race-condition duplicates. Keep the lowest id
    // per (event_id, start_time) group; either is fine since the duplicate
    // rows are functionally identical (same event, same start_time, same
    // end_time written by concurrent materialization). The wrapped subquery
    // forces SQLite/Postgres to materialize the keeper set so the DELETE
    // can safely reference the same table.
    await sequelize.query(
      `DELETE FROM event_instance
       WHERE event_id IS NOT NULL
         AND start_time IS NOT NULL
         AND id NOT IN (
           SELECT min_id FROM (
             SELECT MIN(id) AS min_id
             FROM event_instance
             WHERE event_id IS NOT NULL AND start_time IS NOT NULL
             GROUP BY event_id, start_time
           ) AS keepers
         )`,
      { type: QueryTypes.DELETE },
    );

    await addIndexIfNotExists(
      queryInterface,
      'event_instance',
      ['event_id', 'start_time'],
      {
        name: 'idx_event_instance_event_id_start_time_unique',
        unique: true,
      },
    );
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();
    await removeIndexIfExists(
      queryInterface,
      'event_instance',
      'idx_event_instance_event_id_start_time_unique',
    );
  },
};
