import { Sequelize, DataTypes } from 'sequelize';
import {
  addColumnIfNotExists,
  removeColumnIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Add hide_from_public column to event_schedule table.
 *
 * Distinguishes between two kinds of exclusion schedules:
 *   - hide_from_public = true  (EXDATE semantics): the instance is silently
 *     omitted from public-facing calendar output. This matches pre-feature
 *     behavior, so existing rows default to true.
 *   - hide_from_public = false (RECURRENCE-ID cancellation override): the
 *     instance is still emitted publicly, but marked as cancelled so viewers
 *     know the specific occurrence will not take place.
 *
 * Only meaningful when is_exclusion = true. Default true preserves historical
 * behavior for any exclusion schedules created before this column existed.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addColumnIfNotExists(queryInterface, 'event_schedule', 'hide_from_public', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeColumnIfExists(queryInterface, 'event_schedule', 'hide_from_public');
  },
};
