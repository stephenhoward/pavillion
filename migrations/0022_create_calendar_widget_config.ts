import { Sequelize, DataTypes } from 'sequelize';
import {
  createTableIfNotExists,
  tableExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Create calendar_widget_config table.
 *
 * Stores per-calendar widget display configuration (view mode, accent color,
 * color mode). Replaces the prior embed-snippet query-string approach so that
 * calendar owners can change widget settings in the admin UI without editing
 * the HTML on their embedding site.
 *
 * Design:
 * - Unique FK on calendar_id enforces one config per calendar (lazy-created
 *   when the owner first saves; no backfill for existing calendars).
 * - ON DELETE CASCADE cleans up the config row automatically when the parent
 *   calendar is deleted.
 *
 * Reference: docs/superpowers/specs/2026-04-14-server-side-widget-config-design.md
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await createTableIfNotExists(queryInterface, 'calendar_widget_config', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
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
      view: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      accent_color: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      color_mode: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });

    // Unique constraint on calendar_id enforces one config per calendar.
    await queryInterface.addIndex('calendar_widget_config', ['calendar_id'], {
      name: 'unique_calendar_widget_config_calendar',
      unique: true,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    if (await tableExists(queryInterface, 'calendar_widget_config')) {
      await queryInterface.dropTable('calendar_widget_config');
    }
  },
};
