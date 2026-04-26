import { Sequelize } from 'sequelize';

/**
 * Test migration that intentionally fails
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    throw new Error('Migration failed intentionally');
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    // Nothing to roll back since up() fails
  },
};
