import { Sequelize, DataTypes } from 'sequelize';

/**
 * Add Display Name to Account Table
 *
 * This migration adds an optional display_name column to the account table.
 * Display names allow users to have a friendly name shown in the interface
 * that is separate from their username.
 *
 * The display_name is nullable to allow users to optionally set this field.
 * If not set, the system should fall back to using the username for display.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // Add display_name column to account table
    await queryInterface.addColumn('account', 'display_name', {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Optional friendly display name for the user',
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();
    await queryInterface.removeColumn('account', 'display_name');
  },
};
