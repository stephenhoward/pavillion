import { Sequelize, DataTypes } from 'sequelize';

/**
 * Create event_series and event_series_content tables, and add
 * series_id foreign key to the event table.
 *
 * event_series holds series metadata (url_name, media, calendar link).
 * event_series_content holds translatable name/description per language.
 * event.series_id links individual events to their series.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.createTable('event_series', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      calendar_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'calendar',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      url_name: {
        type: DataTypes.STRING(24),
        allowNull: false,
      },
      media_id: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });

    await queryInterface.addIndex('event_series', ['calendar_id', 'url_name'], {
      name: 'idx_event_series_calendar_url_name',
      unique: true,
    });

    await queryInterface.createTable('event_series_content', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      series_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'event_series',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      language: {
        type: DataTypes.STRING(5),
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    });

    await queryInterface.addColumn('event', 'series_id', {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'event_series',
        key: 'id',
      },
      onDelete: 'SET NULL',
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.removeColumn('event', 'series_id');
    await queryInterface.dropTable('event_series_content');
    await queryInterface.dropTable('event_series');
  },
};
