import { Sequelize, DataTypes } from 'sequelize';

/**
 * Add Remote Calendar Access Table
 *
 * This migration adds support for tracking which local users have editor access
 * to calendars on remote (federated) instances.
 *
 * When a remote instance grants editor access to a local user, an ActivityPub
 * notification is sent, and this table stores the relationship. This enables
 * local event creation to be proxied to the remote calendar.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // remote_calendar_access - Tracks local users' access to remote calendars
    await queryInterface.createTable('remote_calendar_access', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      account_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'account',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      remote_calendar_id: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: 'UUID of the remote calendar (as known on the remote instance)',
      },
      remote_calendar_actor_uri: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'ActivityPub actor URI of the remote calendar',
      },
      remote_calendar_inbox_url: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Inbox URL for sending ActivityPub activities',
      },
      remote_calendar_domain: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Domain of the remote instance',
      },
      granted_at: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: 'When the access was granted by the remote instance',
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

    // Add index on account_id for efficient lookups
    await queryInterface.addIndex('remote_calendar_access', ['account_id'], {
      name: 'idx_remote_calendar_access_account_id',
    });

    // Add index on remote_calendar_id for matching event creation requests
    await queryInterface.addIndex('remote_calendar_access', ['remote_calendar_id'], {
      name: 'idx_remote_calendar_access_remote_calendar_id',
    });

    // Add unique constraint on (account_id, remote_calendar_id) to prevent duplicates
    await queryInterface.addIndex('remote_calendar_access', ['account_id', 'remote_calendar_id'], {
      name: 'unique_remote_calendar_access',
      unique: true,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();
    await queryInterface.dropTable('remote_calendar_access');
  },
};
