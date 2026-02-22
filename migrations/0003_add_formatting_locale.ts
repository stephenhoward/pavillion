import { Sequelize, DataTypes } from 'sequelize';

/**
 * Add formatting_locale column to account table.
 *
 * The formatting_locale column stores the user's preferred locale code for
 * number, date, and currency formatting (e.g. 'en-US', 'de-DE'). This is
 * separate from the language column which controls UI translation language.
 *
 * A null value means the user has not set a formatting locale preference,
 * and the application should fall back to the instance default or browser
 * locale for formatting operations.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.addColumn('account', 'formatting_locale', {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: null,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.removeColumn('account', 'formatting_locale');
  },
};
