import { Sequelize, DataTypes } from 'sequelize';
import {
  addColumnIfNotExists,
  removeColumnIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Add `image_alt` to the three content tables — `event_content`,
 * `event_series_content`, and `calendar_content`.
 *
 * Alt text for an event, series, or calendar default image is content, so it
 * is translated per language and rides the existing per-language content row
 * rather than the `media` row: media rows are deduplicated per calendar by
 * sha256, so one row can back several events, while alt text is per use.
 *
 * Nullable with no backfill and no default. Null and empty string both mean
 * "no alt in this language"; an image is decorative unless some language
 * carries non-empty alt text, so an absent value needs no distinct encoding.
 *
 * The name deliberately avoids "accessibility" to stay clear of the existing
 * `accessibility_info` column on `event_content`, which describes venue
 * accessibility rather than an image.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addColumnIfNotExists(queryInterface, 'event_content', 'image_alt', {
      type: DataTypes.TEXT,
      allowNull: true,
    });
    await addColumnIfNotExists(queryInterface, 'event_series_content', 'image_alt', {
      type: DataTypes.TEXT,
      allowNull: true,
    });
    await addColumnIfNotExists(queryInterface, 'calendar_content', 'image_alt', {
      type: DataTypes.TEXT,
      allowNull: true,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeColumnIfExists(queryInterface, 'event_content', 'image_alt');
    await removeColumnIfExists(queryInterface, 'event_series_content', 'image_alt');
    await removeColumnIfExists(queryInterface, 'calendar_content', 'image_alt');
  },
};
