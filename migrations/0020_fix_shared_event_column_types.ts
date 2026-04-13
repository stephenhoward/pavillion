import { Sequelize } from 'sequelize';

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
 *
 * PostgreSQL requires an explicit USING cast when converting VARCHAR to UUID,
 * so we use raw SQL instead of queryInterface.changeColumn.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const dialect = sequelize.getDialect();

    if (dialect === 'postgres') {
      await sequelize.query(`
        ALTER TABLE "ap_shared_event"
          ALTER COLUMN "event_id" TYPE UUID USING "event_id"::uuid,
          ALTER COLUMN "calendar_id" TYPE UUID USING "calendar_id"::uuid;
      `);
    }
    // SQLite has no strict column types; ALTER COLUMN is not supported.
    // The entity already declares UUID, which SQLite stores as TEXT regardless.
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const dialect = sequelize.getDialect();

    if (dialect === 'postgres') {
      await sequelize.query(`
        ALTER TABLE "ap_shared_event"
          ALTER COLUMN "event_id" TYPE VARCHAR(255),
          ALTER COLUMN "calendar_id" TYPE VARCHAR(255);
      `);
    }
  },
};
