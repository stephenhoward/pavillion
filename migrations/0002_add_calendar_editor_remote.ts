import { Sequelize, DataTypes } from 'sequelize';

/**
 * Add Calendar Editor Remote Table
 *
 * This migration adds support for federated (remote) calendar editors.
 * Remote editors are users from other ActivityPub instances who have
 * been granted editor access to a local calendar.
 *
 * Unlike local editors (stored in calendar_editor_person), remote editors
 * are identified by their ActivityPub actor URI rather than a local account ID.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // calendar_editor_remote - Remote (federated) calendar editors
    await queryInterface.createTable('calendar_editor_remote', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      calendar_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'calendar',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      actor_uri: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'ActivityPub actor URI of the remote editor (e.g., https://beta.federation.local/users/Admin)',
      },
      remote_username: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Username portion of the remote editor identity',
      },
      remote_domain: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Domain of the remote instance',
      },
      granted_by: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'account',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // Add index on calendar_id for efficient queries
    await queryInterface.addIndex('calendar_editor_remote', ['calendar_id'], {
      name: 'idx_calendar_editor_remote_calendar_id',
    });

    // Add index on actor_uri for lookups by actor
    await queryInterface.addIndex('calendar_editor_remote', ['actor_uri'], {
      name: 'idx_calendar_editor_remote_actor_uri',
    });

    // Add unique constraint on (calendar_id, actor_uri) to prevent duplicates
    await queryInterface.addIndex('calendar_editor_remote', ['calendar_id', 'actor_uri'], {
      name: 'unique_calendar_editor_remote',
      unique: true,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();
    await queryInterface.dropTable('calendar_editor_remote');
  },
};
