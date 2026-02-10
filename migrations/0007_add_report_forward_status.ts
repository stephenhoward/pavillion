import { Sequelize, DataTypes } from 'sequelize';

/**
 * Add Forward Status Column to Report Table
 *
 * This migration adds support for tracking acknowledgment of forwarded reports
 * from remote instances. When a report is forwarded via a Flag activity, the
 * remote instance can respond with an Accept activity to acknowledge receipt.
 *
 * Changes:
 * - Adds forward_status ENUM column with values: pending, acknowledged, no_response
 * - Column is nullable since it only applies to forwarded reports
 *
 * Status meanings:
 * - pending: Flag activity sent, awaiting acknowledgment
 * - acknowledged: Remote instance sent Accept activity confirming receipt
 * - no_response: Remote instance did not respond within expected timeframe
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // Add forward_status ENUM column
    await queryInterface.addColumn('report', 'forward_status', {
      type: DataTypes.ENUM('pending', 'acknowledged', 'no_response'),
      allowNull: true,
      comment: 'Acknowledgment status for forwarded reports',
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // Remove forward_status column
    await queryInterface.removeColumn('report', 'forward_status');

    // Clean up ENUM type (PostgreSQL specific)
    // Note: SQLite doesn't have native ENUMs so this is safe to attempt
    try {
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_report_forward_status" CASCADE;',
      );
    }
    catch {
      // Ignore errors on non-PostgreSQL databases
    }
  },
};
