import { Sequelize, DataTypes } from 'sequelize';

/**
 * Test migration that creates one table successfully, then fails.
 * Used to verify that the transaction wrapper in the runner rolls back
 * the partial change rather than leaving it half-applied.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // First operation succeeds
    await queryInterface.createTable('test_atomic_first', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
    });

    // Second operation fails
    throw new Error('Migration failed after partial change');
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    // Never reached
  },
};
