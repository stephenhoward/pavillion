import { Sequelize, DataTypes } from 'sequelize';

/**
 * Add Location Content Table
 *
 * This migration adds support for multilingual accessibility information
 * for event locations. Each location can have accessibility descriptions
 * in multiple languages.
 *
 * The location_content table stores translatable accessibility information
 * associated with locations in the location table.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // location_content - Multilingual accessibility information for locations
    await queryInterface.createTable('location_content', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
        allowNull: false,
      },
      location_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'location',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      language: {
        type: DataTypes.STRING(10),
        allowNull: false,
        comment: 'ISO language code (e.g., en, es, fr)',
      },
      accessibility_info: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Accessibility information in the specified language',
      },
    });

    // Add index on location_id for efficient queries
    await queryInterface.addIndex('location_content', ['location_id'], {
      name: 'idx_location_content_location_id',
    });

    // Add unique constraint on (location_id, language) to ensure one content row per language per location
    await queryInterface.addIndex('location_content', ['location_id', 'language'], {
      name: 'unique_location_content_location_language',
      unique: true,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();
    await queryInterface.dropTable('location_content');
  },
};
