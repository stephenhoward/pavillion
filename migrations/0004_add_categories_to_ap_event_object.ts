import { Sequelize, DataTypes } from 'sequelize';

/**
 * Add source_categories column to ap_event_object table.
 *
 * This column stores the category identifiers extracted from incoming
 * ActivityPub event payloads (categories[] array). It enables the auto-repost
 * path to apply category mappings without making additional HTTP calls.
 *
 * The column stores a JSON array of { id: string, name?: string } objects,
 * or null when no categories are present in the incoming payload.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.addColumn('ap_event_object', 'source_categories', {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.removeColumn('ap_event_object', 'source_categories');
  },
};
