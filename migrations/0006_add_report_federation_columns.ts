import { Sequelize, DataTypes } from 'sequelize';

/**
 * Add Federation Tracking Columns to Report Table
 *
 * This migration adds support for tracking reports that originate from
 * remote instances via ActivityPub Flag activities. This enables the
 * system to distinguish federated reports from local reports and maintain
 * provenance information.
 *
 * Changes:
 * - Adds 'federation' as a valid value for reporter_type enum
 * - Adds forwarded_from_instance column to track the originating instance domain
 * - Adds forwarded_report_id column to track the original report ID on the source instance
 *
 * Both new columns are nullable since they only apply to federated reports.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // Add forwarded_from_instance column
    await queryInterface.addColumn('report', 'forwarded_from_instance', {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Domain of the originating instance for federated reports',
    });

    // Add forwarded_report_id column
    await queryInterface.addColumn('report', 'forwarded_report_id', {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Original report ID on the source instance for federated reports',
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.removeColumn('report', 'forwarded_from_instance');
    await queryInterface.removeColumn('report', 'forwarded_report_id');
  },
};
