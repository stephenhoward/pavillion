import { Sequelize, DataTypes } from 'sequelize';

/**
 * Create Blocked Instance Table
 *
 * This migration creates the blocked_instance table for tracking instances
 * that have been blocked from federating with this Pavillion instance.
 * Administrators can block domains that violate policies or community standards.
 *
 * The domain column has a unique constraint to prevent duplicate blocks of
 * the same instance.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // blocked_instance - Blocked ActivityPub instances
    await queryInterface.createTable('blocked_instance', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
        allowNull: false,
      },
      domain: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        comment: 'Domain of the blocked instance (e.g., bad-instance.example.com)',
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'Explanation for why this instance was blocked',
      },
      blocked_at: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: 'Timestamp when the instance was blocked',
      },
      blocked_by: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'account',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Account ID of the administrator who blocked the instance',
      },
    });

    // Add index on domain for efficient lookups
    await queryInterface.addIndex('blocked_instance', ['domain'], {
      name: 'idx_blocked_instance_domain',
      unique: true,
    });

    // Add index on blocked_by for admin audit queries
    await queryInterface.addIndex('blocked_instance', ['blocked_by'], {
      name: 'idx_blocked_instance_blocked_by',
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();
    await queryInterface.dropTable('blocked_instance');
  },
};
