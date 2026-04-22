import { Sequelize } from 'sequelize';
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
