import { Sequelize, DataTypes } from 'sequelize';
import {
  createTableIfNotExists,
  addColumnIfNotExists,
  removeColumnIfExists,
  addIndexIfNotExists,
  removeIndexIfExists,
  tableExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Create location_space and location_space_content tables, add event.space_id,
 * and add origin_uri to location and location_space.
 *
 * Spaces represent named sub-areas within a Place (e.g., a meeting room
 * within a community center, the gazebo in a park). They have translatable
 * name and accessibilityInfo content. An event can be scoped to a
 * (Place, Space) pair, or to just a Place (whole-venue event).
 *
 * Design:
 * - place_id is declared without ON DELETE cascade. Cascade behaviour is
 *   service-orchestrated rather than enforced at the DB layer, matching the
 *   Place/Space design in the spec: removal flows through the locations
 *   service so domain events fire and dependent bookkeeping happens
 *   explicitly.
 * - event.space_id uses ON DELETE SET NULL. The Place + Spaces atomic-save
 *   model treats Space deletion as the trigger for whole-venue fallback:
 *   when an owner removes a Space inside the Place save, any events still
 *   pointing at it should fall back to the parent Place rather than block
 *   the transaction. Surfacing that semantic through the FK lets the
 *   LocationService nest the Space delete inside the same transaction as
 *   the Place upsert without enumerating referencing events.
 * - location_space_content mirrors the location_content shape (no timestamp
 *   columns; translatable rows keyed by language).
 * - event.space_id is nullable: events without a designated sub-area remain
 *   "whole-venue" events.
 * - origin_uri on location and location_space serves as an identity hint
 *   for AP-originated records so the inbox can dedup the same source
 *   Place/Space across many incoming events. Null for locally-created
 *   records. Indexed to keep the inbound dedup lookup cheap as the table
 *   grows.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await createTableIfNotExists(queryInterface, 'location_space', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      place_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'location',
          key: 'id',
        },
      },
      origin_uri: {
        type: DataTypes.STRING(2048),
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });

    await addIndexIfNotExists(queryInterface, 'location_space', ['place_id'], {
      name: 'idx_location_space_place_id',
    });
    await addIndexIfNotExists(queryInterface, 'location_space', ['origin_uri'], {
      name: 'idx_location_space_origin_uri',
    });

    await createTableIfNotExists(queryInterface, 'location_space_content', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      space_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'location_space',
          key: 'id',
        },
      },
      language: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: '',
      },
      accessibility_info: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
      },
    });

    await addIndexIfNotExists(queryInterface, 'location_space_content', ['space_id'], {
      name: 'idx_location_space_content_space_id',
    });

    await addColumnIfNotExists(queryInterface, 'event', 'space_id', {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'location_space',
        key: 'id',
      },
      onDelete: 'SET NULL',
    });

    await addColumnIfNotExists(queryInterface, 'location', 'origin_uri', {
      type: DataTypes.STRING(2048),
      allowNull: true,
    });
    await addIndexIfNotExists(queryInterface, 'location', ['origin_uri'], {
      name: 'idx_location_origin_uri',
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeIndexIfExists(queryInterface, 'location', 'idx_location_origin_uri');
    await removeColumnIfExists(queryInterface, 'location', 'origin_uri');

    await removeColumnIfExists(queryInterface, 'event', 'space_id');

    if (await tableExists(queryInterface, 'location_space_content')) {
      await queryInterface.dropTable('location_space_content');
    }
    if (await tableExists(queryInterface, 'location_space')) {
      await queryInterface.dropTable('location_space');
    }
  },
};
