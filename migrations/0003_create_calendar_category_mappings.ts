import { Sequelize, DataTypes } from 'sequelize';

/**
 * Calendar Category Mappings Migration
 *
 * Creates the calendar_category_mappings table which stores records mapping
 * remote (federated) event categories to local event categories. This enables
 * calendar owners who follow remote calendars to map incoming category tags to
 * their own local category taxonomy.
 *
 * Key design decisions:
 * - source_calendar_actor_id references calendar_actor.id for the remote calendar
 * - source_category_id is a plain UUID with no FK (opaque remote identifier)
 * - local_category_id references event_categories.id (local category)
 * - UNIQUE constraint on (following_calendar_id, source_calendar_actor_id, source_category_id)
 *   ensures one mapping per (local calendar, remote calendar, remote category) triple
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.createTable('calendar_category_mappings', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      following_calendar_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'calendar',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      source_calendar_actor_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'calendar_actor',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      source_category_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      source_category_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      local_category_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'event_categories',
          key: 'id',
        },
        onDelete: 'CASCADE',
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

    await queryInterface.addIndex(
      'calendar_category_mappings',
      ['following_calendar_id', 'source_calendar_actor_id', 'source_category_id'],
      {
        unique: true,
        name: 'unique_calendar_category_mapping',
      },
    );
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.dropTable('calendar_category_mappings');
  },
};
