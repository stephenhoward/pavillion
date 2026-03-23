import { Sequelize, DataTypes } from 'sequelize';
import {
  addColumnIfNotExists,
  removeColumnIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Add Default Event Image to Calendar
 *
 * Adds a nullable default_event_image_id UUID column to the calendar table
 * that references media.id. When a media record is deleted, the FK is set to
 * NULL so the calendar row is preserved.
 *
 * This column stores the media ID for an image that will be used as a
 * fallback for events in this calendar that have no image of their own.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addColumnIfNotExists(queryInterface, 'calendar', 'default_event_image_id', {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'media',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeColumnIfExists(queryInterface, 'calendar', 'default_event_image_id');
  },
};
