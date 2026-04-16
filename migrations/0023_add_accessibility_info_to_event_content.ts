import { Sequelize, DataTypes } from 'sequelize';
import { addColumnIfNotExists, removeColumnIfExists } from '@/server/common/migrations/helpers';

/**
 * Add accessibility_info column to event_content table.
 *
 * Events can now carry per-language accessibility information
 * (e.g., wheelchair access, ASL interpreters) alongside the
 * existing name and description fields.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addColumnIfNotExists(queryInterface, 'event_content', 'accessibility_info', {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: '',
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeColumnIfExists(queryInterface, 'event_content', 'accessibility_info');
  },
};
