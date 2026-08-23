import { Sequelize } from 'sequelize';

/**
 * Probe migration - issues one recognisable statement from each direction so a
 * recording wrapper can place the migration body relative to the runner's
 * session-timeout statements.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    await sequelize.query("SELECT 'migration-body-up'");
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    await sequelize.query("SELECT 'migration-body-down'");
  },
};
