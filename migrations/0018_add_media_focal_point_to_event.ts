import { Sequelize, DataTypes } from 'sequelize';
import {
  addColumnIfNotExists,
  removeColumnIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Add Media Focal Point and Zoom to Event and Event Series
 *
 * Adds media_focal_point_x, media_focal_point_y, and media_zoom columns
 * to both the event and event_series tables. These columns store the
 * crop/zoom settings for the event or series hero image.
 *
 * Defaults: focal point center (0.5, 0.5), zoom 1.0 (no zoom).
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // event table
    await addColumnIfNotExists(queryInterface, 'event', 'media_focal_point_x', {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0.5,
    });
    await addColumnIfNotExists(queryInterface, 'event', 'media_focal_point_y', {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0.5,
    });
    await addColumnIfNotExists(queryInterface, 'event', 'media_zoom', {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 1.0,
    });

    // event_series table
    await addColumnIfNotExists(queryInterface, 'event_series', 'media_focal_point_x', {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0.5,
    });
    await addColumnIfNotExists(queryInterface, 'event_series', 'media_focal_point_y', {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0.5,
    });
    await addColumnIfNotExists(queryInterface, 'event_series', 'media_zoom', {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 1.0,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // event table
    await removeColumnIfExists(queryInterface, 'event', 'media_focal_point_x');
    await removeColumnIfExists(queryInterface, 'event', 'media_focal_point_y');
    await removeColumnIfExists(queryInterface, 'event', 'media_zoom');

    // event_series table
    await removeColumnIfExists(queryInterface, 'event_series', 'media_focal_point_x');
    await removeColumnIfExists(queryInterface, 'event_series', 'media_focal_point_y');
    await removeColumnIfExists(queryInterface, 'event_series', 'media_zoom');
  },
};
