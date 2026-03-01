import { Sequelize, DataTypes } from 'sequelize';

/**
 * Create notification table.
 *
 * Stores notifications for calendar owners and editors. Supports two
 * notification types:
 *   - 'follow': someone followed a calendar
 *   - 'repost': someone reposted an event from a calendar
 *
 * Indexes on account_id (for per-user notification queries) and
 * created_at (for cleanup jobs and ordered retrieval).
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.createTable('notification', {
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
        onDelete: 'CASCADE',
      },
      type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      calendar_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      event_id: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      actor_name: {
        type: DataTypes.STRING(256),
        allowNull: false,
      },
      actor_url: {
        type: DataTypes.STRING(2048),
        allowNull: true,
      },
      seen: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });

    await queryInterface.addIndex('notification', ['account_id'], {
      name: 'notification_account_id_idx',
    });

    await queryInterface.addIndex('notification', ['created_at'], {
      name: 'notification_created_at_idx',
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.dropTable('notification');
  },
};
