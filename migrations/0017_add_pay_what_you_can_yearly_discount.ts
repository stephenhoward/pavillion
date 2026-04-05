import { Sequelize, DataTypes } from 'sequelize';

/**
 * Add pay_what_you_can_yearly_discount column to funding_settings table.
 *
 * Stores the percentage discount applied to yearly pay-what-you-can
 * funding plans. Defaults to 0 (no discount).
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.addColumn('funding_settings', 'pay_what_you_can_yearly_discount', {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.removeColumn('funding_settings', 'pay_what_you_can_yearly_discount');
  },
};
