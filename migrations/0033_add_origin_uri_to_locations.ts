import { Sequelize, DataTypes } from 'sequelize';
import {
  addColumnIfNotExists,
  removeColumnIfExists,
  addIndexIfNotExists,
  removeIndexIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Add origin_uri to location and location_space.
 *
 * Used as an identity hint for AP-originated records so the inbox can
 * dedup the same source Place/Space across many incoming events. Null
 * for locally-created records. Indexed to keep the inbound dedup lookup
 * cheap as the table grows.
 *
 * Reference: docs/superpowers/plans/2026-05-05-place-spaces.md (Task 2.1),
 * bead pv-ix7v.6.1.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addColumnIfNotExists(queryInterface, 'location', 'origin_uri', {
      type: DataTypes.STRING(2048),
      allowNull: true,
    });
    await addIndexIfNotExists(queryInterface, 'location', ['origin_uri'], {
      name: 'idx_location_origin_uri',
    });

    await addColumnIfNotExists(queryInterface, 'location_space', 'origin_uri', {
      type: DataTypes.STRING(2048),
      allowNull: true,
    });
    await addIndexIfNotExists(queryInterface, 'location_space', ['origin_uri'], {
      name: 'idx_location_space_origin_uri',
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeIndexIfExists(queryInterface, 'location_space', 'idx_location_space_origin_uri');
    await removeColumnIfExists(queryInterface, 'location_space', 'origin_uri');
    await removeIndexIfExists(queryInterface, 'location', 'idx_location_origin_uri');
    await removeColumnIfExists(queryInterface, 'location', 'origin_uri');
  },
};
