import { Sequelize } from 'sequelize';
import {
  addIndexIfNotExists,
  removeIndexIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Index the unprocessed ap_inbox rows for the inbox drain.
 *
 * Every drain tick runs `WHERE processed_time IS NULL [AND createdAt < cutoff]
 * ORDER BY message_time, createdAt LIMIT 1000`. Until now ap_inbox had no index
 * beyond its primary key, and processed rows (Follow and Announce among them)
 * are never cleaned up, so each tick was a full scan of a table that only
 * grows.
 *
 * The index is partial on `processed_time IS NULL`. The unprocessed set is
 * normally empty or a handful of rows, so the index stays tiny whatever the
 * table size, and its column order matches the drain's ORDER BY so the query
 * reads rows in order without a sort. Both PostgreSQL and SQLite support
 * partial indexes with a plain-column predicate, so no dialect fallback is
 * needed (unlike the functional index in 0028, which SQLite's describeTable()
 * cannot read).
 *
 * Locking: the runner wraps each migration in a transaction, so CREATE INDEX
 * CONCURRENTLY is unavailable. A plain CREATE INDEX holds a SHARE lock that
 * blocks inbox writes while it builds. That is accepted deliberately — ap_inbox
 * is small on every current deployment, so the build is brief. The runner
 * already clears the session timeouts for the migration transaction.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addIndexIfNotExists(queryInterface, 'ap_inbox', ['message_time', 'createdAt'], {
      name: 'idx_ap_inbox_unprocessed',
      where: { processed_time: null },
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeIndexIfExists(queryInterface, 'ap_inbox', 'idx_ap_inbox_unprocessed');
  },
};
