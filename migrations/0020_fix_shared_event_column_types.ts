import { Sequelize, DataTypes } from 'sequelize';

/**
 * Fix type mismatch in ap_shared_event table.
 *
 * The initial migration (0001) created event_id and calendar_id as STRING,
 * but these columns store UUIDs and are joined against UUID columns
 * (event.id, calendar_actor.calendar_id). This causes "operator does not
 * exist: character varying = uuid" on PostgreSQL.
 *
 * The entity (SharedEventEntity) already declares these as DataType.UUID,
 * so this migration brings the schema in line with the entity definition.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.changeColumn('ap_shared_event', 'event_id', {
      type: DataTypes.UUID,
      allowNull: true,
    });

    await queryInterface.changeColumn('ap_shared_event', 'calendar_id', {
      type: DataTypes.UUID,
      allowNull: true,
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.changeColumn('ap_shared_event', 'calendar_id', {
      type: DataTypes.STRING,
      allowNull: true,
    });

    await queryInterface.changeColumn('ap_shared_event', 'event_id', {
      type: DataTypes.STRING,
      allowNull: true,
    });
  },
};
