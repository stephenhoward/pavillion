import { Sequelize, DataTypes } from 'sequelize';
import {
  createTableIfNotExists,
  tableExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Create disk_usage_snapshot — the worker's record of filesystem usage for
 * paths the web process cannot measure itself.
 *
 * The backup volume is mounted into the worker container only, so the app
 * container's statfs of /backups fails in the production compose topology.
 * The worker writes what it measured here on its existing hourly disk:check
 * schedule, and the web process (admin status panel, metrics endpoint) reads
 * it back.
 *
 * Design:
 * - stat_key is the primary key: one row per monitored filesystem, upserted
 *   in place rather than appended. Nothing consumes the history, and an
 *   append log would need its own retention job.
 * - written_at is explicit rather than a Sequelize updatedAt, because it is
 *   read as data (exposed as a metric series) so an operator can alert on the
 *   snapshot going stale when the worker dies.
 * - Byte counts are BIGINT: a multi-terabyte volume overflows INTEGER.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await createTableIfNotExists(queryInterface, 'disk_usage_snapshot', {
      stat_key: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      path: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      total_bytes: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      free_bytes: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      used_bytes: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      percentage_used: {
        type: DataTypes.DOUBLE,
        allowNull: false,
      },
      written_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    if (await tableExists(queryInterface, 'disk_usage_snapshot')) {
      await queryInterface.dropTable('disk_usage_snapshot');
    }
  },
};
