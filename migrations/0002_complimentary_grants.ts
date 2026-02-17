import { Sequelize, DataTypes } from 'sequelize';

/**
 * Complimentary Grants Migration
 *
 * Creates the complimentary_grant table which stores records of accounts
 * that have been granted complimentary (free) access to gated subscription features.
 *
 * Key design decisions:
 * - Soft-delete pattern: grants are revoked by setting revoked_at/revoked_by,
 *   not by deleting the record. This preserves audit trail.
 * - Unique partial index: only one active (non-revoked) grant per account
 *   is permitted at any time.
 * - Index on account_id for fast lookups when checking access.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.createTable('complimentary_grant', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
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
      expires_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      reason: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      granted_by: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      revoked_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      revoked_by: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });

    // Index on account_id for fast grant lookups
    await queryInterface.addIndex('complimentary_grant', ['account_id'], {
      name: 'idx_complimentary_grant_account_id',
    });

    // Unique partial index: only one active (non-revoked) grant per account.
    // This prevents duplicate active grants while allowing historical revoked records.
    await sequelize.query(
      `CREATE UNIQUE INDEX idx_complimentary_grant_unique_active
       ON complimentary_grant (account_id)
       WHERE revoked_at IS NULL`,
    );
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.dropTable('complimentary_grant');
  },
};
