import { Sequelize, DataTypes } from 'sequelize';

/**
 * Widen description columns from VARCHAR(255) to TEXT.
 *
 * The event_content and calendar_content tables were created with
 * DataTypes.STRING (VARCHAR 255) for the description column, which
 * is too restrictive for real-world event and calendar descriptions.
 *
 * Also drops the B-tree index on event_content.description, since
 * PostgreSQL B-tree indexes reject values exceeding ~2700 bytes.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.changeColumn('event_content', 'description', {
      type: DataTypes.TEXT,
      allowNull: true,
    });

    await queryInterface.changeColumn('calendar_content', 'description', {
      type: DataTypes.TEXT,
      allowNull: true,
    });

    // Drop B-tree index on description — incompatible with unbounded TEXT
    await queryInterface.removeIndex('event_content', 'idx_event_content_description');
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.changeColumn('event_content', 'description', {
      type: DataTypes.STRING,
      allowNull: true,
    });

    await queryInterface.changeColumn('calendar_content', 'description', {
      type: DataTypes.STRING,
      allowNull: true,
    });

    // Restore B-tree index on description (safe when column is VARCHAR 255)
    await queryInterface.addIndex('event_content', ['description'], {
      name: 'idx_event_content_description',
    });
  },
};
