import { Sequelize, DataTypes } from 'sequelize';
import { addColumnIfNotExists, removeColumnIfExists } from '@/server/common/migrations/helpers';

/**
 * Add policy column to settings_content table.
 *
 * Instances can now carry a per-language community policy document
 * (e.g., code of conduct, moderation policy) alongside the existing
 * description field on the translatable settings_content table.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addColumnIfNotExists(queryInterface, 'settings_content', 'policy', {
      type: DataTypes.TEXT,
      allowNull: true,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeColumnIfExists(queryInterface, 'settings_content', 'policy');
  },
};
