import { Sequelize } from 'sequelize';

/**
 * Test migration that intentionally fails
 */
export default {
  async up({ context: _sequelize }: { context: Sequelize }) {
    throw new Error('Migration failed intentionally');
  },

  async down({ context: _sequelize }: { context: Sequelize }) {
    // Nothing to roll back since up() fails
  },
};
