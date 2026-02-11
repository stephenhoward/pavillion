import { Sequelize, DataTypes } from 'sequelize';

/**
 * Create Blocked Reporter Table
 *
 * This migration creates the blocked_reporter table for tracking reporter
 * email addresses that have been blocked by administrators due to abuse.
 * Email addresses are stored as hashed values for privacy, and the table
 * tracks who blocked the reporter and why.
 *
 * The email_hash column has a unique constraint to prevent duplicate blocks
 * of the same email address.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // blocked_reporter - Blocked reporter email addresses
    await queryInterface.createTable('blocked_reporter', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
        allowNull: false,
      },
      email_hash: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        comment: 'Hashed email address of the blocked reporter',
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
        comment: 'Account ID of the administrator who blocked the reporter',
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'Explanation for why this reporter was blocked',
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: 'Timestamp when the reporter was blocked',
      },
    });

    // Add index on email_hash for efficient lookups during report submission
    await queryInterface.addIndex('blocked_reporter', ['email_hash'], {
      name: 'idx_blocked_reporter_email_hash',
      unique: true,
    });

    // Add index on blocked_by for admin audit queries
    await queryInterface.addIndex('blocked_reporter', ['blocked_by'], {
      name: 'idx_blocked_reporter_blocked_by',
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();
    await queryInterface.dropTable('blocked_reporter');
  },
};
