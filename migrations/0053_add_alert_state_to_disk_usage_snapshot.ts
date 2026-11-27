import { Sequelize, DataTypes } from 'sequelize';
import {
  addColumnIfNotExists,
  removeColumnIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Add the disk alert's notification state to disk_usage_snapshot.
 *
 * The hourly disk:check run used to email the administrators on every run
 * above a threshold. It now alerts on a change of level and then at most once
 * a day while the level holds, which needs the level last alerted
 * (`alert_level`: 'warning' | 'critical') and when (`alert_sent_at`) to
 * survive a worker restart. They live on the snapshot row the worker already
 * writes for the same filesystem.
 *
 * Both columns are nullable with no default and no backfill: an existing row
 * starts with no alert outstanding, so the first run after the deploy alerts
 * if usage is high.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addColumnIfNotExists(queryInterface, 'disk_usage_snapshot', 'alert_level', {
      type: DataTypes.STRING,
      allowNull: true,
    });

    await addColumnIfNotExists(queryInterface, 'disk_usage_snapshot', 'alert_sent_at', {
      type: DataTypes.DATE,
      allowNull: true,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeColumnIfExists(queryInterface, 'disk_usage_snapshot', 'alert_sent_at');
    await removeColumnIfExists(queryInterface, 'disk_usage_snapshot', 'alert_level');
  },
};
