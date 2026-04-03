import { Sequelize, DataTypes } from 'sequelize';

/**
 * Add event_end_time column to event_schedule table.
 *
 * Stores the end time for individual event occurrences, separate from
 * the recurrence end date (end_date) which controls when a repeating
 * schedule stops generating instances.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.addColumn('event_schedule', 'event_end_time', {
      type: DataTypes.DATE,
      allowNull: true,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.removeColumn('event_schedule', 'event_end_time');
  },
};
