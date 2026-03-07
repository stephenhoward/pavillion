import { Sequelize, DataTypes } from 'sequelize';
import { addColumnIfNotExists } from '../src/server/common/migrations/helpers.js';

/**
 * Add missing forwarded_to_actor_uri column to report table.
 *
 * The ReportEntity has this column defined, but it was missing
 * from the initial schema migration.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // report: add missing forwarded_to_actor_uri column
    await addColumnIfNotExists(queryInterface, 'report', 'forwarded_to_actor_uri', {
      type: DataTypes.STRING,
      allowNull: true,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // Remove forwarded_to_actor_uri column
    const removeColumnIfExists = async (qi: any, table: string, column: string) => {
      const columns = await qi.describeTable(table);
      if (columns[column]) {
        await qi.removeColumn(table, column);
      }
    };

    await removeColumnIfExists(queryInterface, 'report', 'forwarded_to_actor_uri');
  },
};
