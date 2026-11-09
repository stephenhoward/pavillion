import { Sequelize } from 'sequelize';
import {
  addIndexIfNotExists,
  removeIndexIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Index the unprocessed ap_outbox rows for the outbox drain.
 *
 * The web process drains ap_outbox at boot and on an interval
 * (`ActivityPubDomain.startOutboxDrain`), each pass running
 * `WHERE processed_time IS NULL [AND message_time < cutoff]
 * ORDER BY message_time LIMIT 1000`. Outbox rows are never pruned, so without
 * this index every tick scans a table that only grows; the only other index,
 * 0048's (calendar_id, message_time), leads with a column the drain does not
 * filter on.
 *
 * The index is partial on `processed_time IS NULL`, as 0047's inbox twin is:
 * the unprocessed set is normally empty or a handful of rows, so the index
 * stays tiny whatever the table size, and message_time serves both the window
 * filter and the ORDER BY. Both PostgreSQL and SQLite support partial indexes
 * with a plain-column predicate, so no dialect fallback is needed.
 *
 * Locking: the runner wraps each migration in a transaction, so CREATE INDEX
 * CONCURRENTLY is unavailable. A plain CREATE INDEX holds a SHARE lock that
 * blocks outbox writes while it builds; ap_outbox is small on every current
 * deployment, so the build is brief.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addIndexIfNotExists(queryInterface, 'ap_outbox', ['message_time'], {
      name: 'idx_ap_outbox_unprocessed',
      where: { processed_time: null },
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeIndexIfExists(queryInterface, 'ap_outbox', 'idx_ap_outbox_unprocessed');
  },
};
