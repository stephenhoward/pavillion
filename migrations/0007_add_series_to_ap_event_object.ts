import { Sequelize, DataTypes } from 'sequelize';
import { addColumnIfNotExists, removeColumnIfExists } from '../src/server/common/migrations/helpers.js';

/**
 * Add source_series column to ap_event_object table.
 *
 * This column stores the series identifier extracted from incoming
 * ActivityPub event payloads. It enables the auto-repost path to
 * associate federated events with their originating series without
 * making additional HTTP calls.
 *
 * The column stores a JSON value representing the series reference,
 * or null when no series is present in the incoming payload.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addColumnIfNotExists(queryInterface, 'ap_event_object', 'source_series', {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeColumnIfExists(queryInterface, 'ap_event_object', 'source_series');
  },
};
