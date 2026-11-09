import { Sequelize } from 'sequelize';
import {
  addIndexIfNotExists,
  removeIndexIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Index the unprocessed ap_outbox rows for the outbox drain's
 * `WHERE processed_time IS NULL AND message_time <= cutoff ORDER BY
 * message_time` (DEC-024 rule 6). Partial, as 0047's inbox twin is, so its
 * size tracks the backlog, not the table. A plain CREATE INDEX (the runner's
 * transaction rules out CONCURRENTLY) briefly blocks outbox writes.
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
