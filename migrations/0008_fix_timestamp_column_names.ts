import { Sequelize, DataTypes } from 'sequelize';
import { renameColumnIfExists, addColumnIfNotExists, removeColumnIfExists } from '../src/server/common/migrations/helpers.js';

/**
 * Fix timestamp column naming to match entity declarations.
 *
 * Several entities use @CreatedAt/@UpdatedAt decorators with snake_case
 * field names (created_at/updated_at), but the initial migration created
 * these columns with camelCase names (createdAt/updatedAt).
 *
 * Also adds the missing remote_calendar_id column to calendar_actor.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // ap_event_object: rename createdAt → created_at, updatedAt → updated_at
    await renameColumnIfExists(queryInterface, 'ap_event_object', 'createdAt', 'created_at');
    await renameColumnIfExists(queryInterface, 'ap_event_object', 'updatedAt', 'updated_at');

    // event_categories: rename createdAt → created_at, updatedAt → updated_at
    await renameColumnIfExists(queryInterface, 'event_categories', 'createdAt', 'created_at');
    await renameColumnIfExists(queryInterface, 'event_categories', 'updatedAt', 'updated_at');

    // event_category_assignments: rename createdAt → created_at
    await renameColumnIfExists(queryInterface, 'event_category_assignments', 'createdAt', 'created_at');

    // event_repost: rename createdAt → created_at
    await renameColumnIfExists(queryInterface, 'event_repost', 'createdAt', 'created_at');

    // calendar_actor: add missing remote_calendar_id column
    await addColumnIfNotExists(queryInterface, 'calendar_actor', 'remote_calendar_id', {
      type: DataTypes.UUID,
      allowNull: true,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // Reverse timestamp renames
    await renameColumnIfExists(queryInterface, 'ap_event_object', 'created_at', 'createdAt');
    await renameColumnIfExists(queryInterface, 'ap_event_object', 'updated_at', 'updatedAt');

    await renameColumnIfExists(queryInterface, 'event_categories', 'created_at', 'createdAt');
    await renameColumnIfExists(queryInterface, 'event_categories', 'updated_at', 'updatedAt');

    await renameColumnIfExists(queryInterface, 'event_category_assignments', 'created_at', 'createdAt');

    await renameColumnIfExists(queryInterface, 'event_repost', 'created_at', 'createdAt');

    // Remove remote_calendar_id
    await removeColumnIfExists(queryInterface, 'calendar_actor', 'remote_calendar_id');
  },
};
