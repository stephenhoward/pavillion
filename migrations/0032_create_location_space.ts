import { Sequelize, DataTypes } from 'sequelize';
import {
  createTableIfNotExists,
  addColumnIfNotExists,
  removeColumnIfExists,
  tableExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Create location_space and location_space_content tables, and add the
 * event.space_id column.
 *
 * Spaces represent named sub-areas within a Place (e.g., a meeting room
 * within a community center, the gazebo in a park). They have translatable
 * name and accessibilityInfo content. An event can be scoped to a
 * (Place, Space) pair, or to just a Place (whole-venue event).
 *
 * Design:
 * - place_id and space_id foreign keys are declared without ON DELETE
 *   cascade. Cascade behaviour is service-orchestrated rather than enforced
 *   at the DB layer, matching the Place/Space design in the spec: removal
 *   flows through the locations service so domain events fire and dependent
 *   bookkeeping (e.g. event.space_id null-out) happens explicitly.
 * - location_space_content mirrors the location_content shape (no timestamp
 *   columns; translatable rows keyed by language).
 * - event.space_id is nullable: events without a designated sub-area remain
 *   "whole-venue" events.
 *
 * Bead: pv-ix7v.1.1.
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

    await queryInterface.addIndex('location_space', ['place_id'], {
      name: 'idx_location_space_place_id',
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

    await queryInterface.addIndex('location_space_content', ['space_id'], {
      name: 'idx_location_space_content_space_id',
    });

    await addColumnIfNotExists(queryInterface, 'event', 'space_id', {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'location_space',
        key: 'id',
      },
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeColumnIfExists(queryInterface, 'event', 'space_id');

    if (await tableExists(queryInterface, 'location_space_content')) {
      await queryInterface.dropTable('location_space_content');
    }
    if (await tableExists(queryInterface, 'location_space')) {
      await queryInterface.dropTable('location_space');
    }
  },
};
