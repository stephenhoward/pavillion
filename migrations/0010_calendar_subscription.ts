import { Sequelize, DataTypes } from 'sequelize';
import {
  createTableIfNotExists,
  addColumnIfNotExists,
  removeColumnIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Calendar Subscription Migration
 *
 * Creates the calendar_subscription table which stores per-calendar allocation
 * records for user subscriptions. Each row represents how much of a subscription's
 * funds are directed to a specific calendar.
 *
 * Also adds a nullable calendar_id column to complimentary_grant so that
 * complimentary grants can be scoped to individual calendars.
 *
 * Key design decisions:
 * - end_time NULL means the allocation is currently active
 * - Unique partial index ensures only one active allocation per
 *   (subscription, calendar) pair at any time
 * - calendar_id on complimentary_grant is nullable initially; a later
 *   data migration (pv-rx1e.5) will populate and tighten the constraint
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // Create calendar_subscription table
    await createTableIfNotExists(queryInterface, 'calendar_subscription', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      subscription_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'user_subscription',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      calendar_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'calendar',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      amount: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      end_time: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // Unique partial index: only one active allocation per (subscription, calendar)
    await sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_subscription_unique_active
       ON calendar_subscription (subscription_id, calendar_id)
       WHERE end_time IS NULL`,
    );

    // Add nullable calendar_id to complimentary_grant
    await addColumnIfNotExists(queryInterface, 'complimentary_grant', 'calendar_id', {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'calendar',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // Remove calendar_id from complimentary_grant
    await removeColumnIfExists(queryInterface, 'complimentary_grant', 'calendar_id');

    // Drop calendar_subscription table (also drops its indexes)
    await queryInterface.dropTable('calendar_subscription');
  },
};
