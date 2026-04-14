import { Sequelize, DataTypes } from 'sequelize';

/**
 * Add external_url and url_prompt columns to the event table.
 *
 * external_url stores an optional off-site URL (e.g., a registration or
 * informational link) for the event. url_prompt stores an optional short
 * label displayed to users before following the URL.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.addColumn('event', 'external_url', {
      type: DataTypes.STRING(2048),
      allowNull: true,
    });

    await queryInterface.addColumn('event', 'url_prompt', {
      type: DataTypes.STRING(32),
      allowNull: true,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.removeColumn('event', 'url_prompt');
    await queryInterface.removeColumn('event', 'external_url');
  },
};
