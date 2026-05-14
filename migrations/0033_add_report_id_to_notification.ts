import { Sequelize, DataTypes } from 'sequelize';

/**
 * Add report_id column to notification table.
 *
 * Allows the inbox to deep-link from a report_* notification row to the
 * specific report it surfaces. The column is nullable because only the
 * report_received, report_verified, and report_escalated types carry a
 * report reference; follow, repost, and unshare rows leave it null.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.addColumn('notification', 'report_id', {
      type: DataTypes.UUID,
      allowNull: true,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.removeColumn('notification', 'report_id');
  },
};
