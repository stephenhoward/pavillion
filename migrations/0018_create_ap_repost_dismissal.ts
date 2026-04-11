import { Sequelize, DataTypes } from 'sequelize';
import {
  createTableIfNotExists,
  tableExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Create ap_repost_dismissal table.
 *
 * Stores sticky "do not auto-repost" markers so that once a calendar owner
 * unposts a reposted event, the inbox auto-repost handler will not silently
 * re-create a SharedEventEntity when the source calendar re-broadcasts the
 * event. Manual re-shares by the owner supersede the dismissal.
 *
 * Design:
 * - Unique index on (event_id, calendar_id) enforces one dismissal row per
 *   (event, calendar) pair.
 * - ON DELETE CASCADE on event_id cleans up dismissals automatically when
 *   the underlying local event row is deleted.
 *
 * Reference: docs/superpowers/specs/2026-04-11-unpost-reposted-events-design.md
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await createTableIfNotExists(queryInterface, 'ap_repost_dismissal', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      event_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'event',
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
      dismissed_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // Unique index enforcing one dismissal per (event, calendar) pair.
    await queryInterface.addIndex('ap_repost_dismissal', ['event_id', 'calendar_id'], {
      name: 'idx_ap_repost_dismissal_event_calendar',
      unique: true,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    if (await tableExists(queryInterface, 'ap_repost_dismissal')) {
      await queryInterface.dropTable('ap_repost_dismissal');
    }
  },
};
