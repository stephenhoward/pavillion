import { Sequelize } from 'sequelize';
import {
  tableExists,
  renameColumnIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Rename Subscription Tables and Columns to Funding Terminology
 *
 * Renames tables:
 *   user_subscription   -> funding_plan
 *   subscription_settings -> funding_settings
 *   subscription_event  -> funding_event
 *
 * Renames columns:
 *   funding_event.subscription_id     -> funding_plan_id
 *   calendar_subscription.subscription_id -> funding_plan_id
 *
 * Also updates the unique partial index on calendar_subscription to reference
 * the renamed column.
 *
 * SQLite does not support ALTER TABLE ... RENAME TO if the table has certain
 * constraints, but Sequelize's queryInterface.renameTable works for both
 * PostgreSQL and SQLite.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // --- 1. Rename tables ---
    // Order matters: rename tables that are referenced by foreign keys FIRST
    // so that dependent tables still find the referenced table under the new name.
    // However, SQLite does not enforce FK constraints during ALTER TABLE, and
    // PostgreSQL renames the table in-place (FKs follow automatically).

    if (await tableExists(queryInterface, 'user_subscription')) {
      await queryInterface.renameTable('user_subscription', 'funding_plan');
    }

    if (await tableExists(queryInterface, 'subscription_settings')) {
      await queryInterface.renameTable('subscription_settings', 'funding_settings');
    }

    if (await tableExists(queryInterface, 'subscription_event')) {
      await queryInterface.renameTable('subscription_event', 'funding_event');
    }

    // --- 2. Rename columns ---
    // funding_event: subscription_id -> funding_plan_id
    await renameColumnIfExists(queryInterface, 'funding_event', 'subscription_id', 'funding_plan_id');

    // calendar_subscription: subscription_id -> funding_plan_id
    await renameColumnIfExists(queryInterface, 'calendar_subscription', 'subscription_id', 'funding_plan_id');

    // --- 3. Recreate the unique partial index on calendar_subscription ---
    // Drop the old index that referenced subscription_id
    try {
      await sequelize.query('DROP INDEX IF EXISTS idx_calendar_subscription_unique_active');
    }
    catch {
      try {
        await queryInterface.removeIndex('calendar_subscription', 'idx_calendar_subscription_unique_active');
      }
      catch {
        console.warn('[migration 0012] Could not drop idx_calendar_subscription_unique_active, may not exist');
      }
    }

    // Create the new index with the renamed column
    await sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_subscription_unique_active
       ON calendar_subscription (funding_plan_id, calendar_id)
       WHERE end_time IS NULL`,
    );
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // --- 1. Restore column names ---
    await renameColumnIfExists(queryInterface, 'calendar_subscription', 'funding_plan_id', 'subscription_id');

    // Rename tables back (must exist under new names)
    if (await tableExists(queryInterface, 'funding_event')) {
      await renameColumnIfExists(queryInterface, 'funding_event', 'funding_plan_id', 'subscription_id');
      await queryInterface.renameTable('funding_event', 'subscription_event');
    }

    if (await tableExists(queryInterface, 'funding_settings')) {
      await queryInterface.renameTable('funding_settings', 'subscription_settings');
    }

    if (await tableExists(queryInterface, 'funding_plan')) {
      await queryInterface.renameTable('funding_plan', 'user_subscription');
    }

    // --- 2. Restore the unique partial index on calendar_subscription ---
    try {
      await sequelize.query('DROP INDEX IF EXISTS idx_calendar_subscription_unique_active');
    }
    catch {
      try {
        await queryInterface.removeIndex('calendar_subscription', 'idx_calendar_subscription_unique_active');
      }
      catch {
        console.warn('[migration 0012] Could not drop idx_calendar_subscription_unique_active');
      }
    }

    await sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_subscription_unique_active
       ON calendar_subscription (subscription_id, calendar_id)
       WHERE end_time IS NULL`,
    );
  },
};
