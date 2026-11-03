import { Sequelize } from 'sequelize';
import {
  addIndexIfNotExists,
  removeIndexIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Index ap_outbox on (calendar_id, message_time) for per-calendar outbox paging.
 *
 * ActivityPubService.readOutbox serves the public calendar outbox: one
 * calendar's rows, filtered to public types and `processed_status = 'ok'`,
 * newest first below a message_time cursor, plus a count of the same set.
 * Until now ap_outbox had no index beyond its primary key, and outbox rows are
 * never pruned, so every page and every count scanned every calendar's
 * activities on the instance.
 *
 * The column order matches the query: equality on calendar_id, then
 * message_time for the cursor range and the ORDER BY, so a page is a backward
 * index scan that stops after `limit` rows. type and processed_status are left
 * out deliberately: nearly every outbox row is a public type with status 'ok',
 * so filtering them on the heap rows the index returns costs little, and
 * putting either ahead of message_time would break the ordered scan.
 *
 * Locking: the runner wraps each migration in a transaction, so CREATE INDEX
 * CONCURRENTLY is unavailable. A plain CREATE INDEX holds a SHARE lock that
 * blocks outbox writes while it builds; ap_outbox is small on every current
 * deployment, so the build is brief.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addIndexIfNotExists(queryInterface, 'ap_outbox', ['calendar_id', 'message_time'], {
      name: 'idx_ap_outbox_calendar_message_time',
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeIndexIfExists(queryInterface, 'ap_outbox', 'idx_ap_outbox_calendar_message_time');
  },
};
