import { Sequelize, DataTypes } from 'sequelize';
import {
  createTableIfNotExists,
  tableExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Create Settings Content Table
 *
 * Migrates instance description storage from a JSON blob in the
 * service_config key-value table to a dedicated settings_content table
 * following the established translatable content pattern (e.g.
 * calendar_content, event_category_content).
 *
 * Also migrates existing data from the old JSON format to individual rows.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await createTableIfNotExists(queryInterface, 'settings_content', {
      language: {
        type: DataTypes.STRING(5),
        primaryKey: true,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    });

    // Migrate existing JSON blob data from service_config
    const [rows] = await sequelize.query(
      `SELECT value FROM service_config WHERE parameter = 'instanceDescription'`,
    ) as [Array<{ value: string }>, unknown];

    if (rows.length > 0) {
      try {
        const descriptions = JSON.parse(rows[0].value) as Record<string, string>;
        for (const [language, description] of Object.entries(descriptions)) {
          if (typeof description === 'string' && description.length > 0) {
            await sequelize.query(
              `INSERT INTO settings_content (language, description) VALUES (:language, :description)
               ON CONFLICT (language) DO UPDATE SET description = :description`,
              { replacements: { language, description } },
            );
          }
        }
      }
      catch {
        // Invalid JSON in old row — skip data migration
      }

      // Remove the old JSON blob row
      await sequelize.query(
        `DELETE FROM service_config WHERE parameter = 'instanceDescription'`,
      );
    }
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    // Migrate data back to JSON blob in service_config
    if (await tableExists(queryInterface, 'settings_content')) {
      const [rows] = await sequelize.query(
        `SELECT language, description FROM settings_content`,
      ) as [Array<{ language: string; description: string }>, unknown];

      if (rows.length > 0) {
        const descriptions: Record<string, string> = {};
        for (const row of rows) {
          descriptions[row.language] = row.description;
        }
        const jsonValue = JSON.stringify(descriptions);
        await sequelize.query(
          `INSERT INTO service_config (parameter, value) VALUES ('instanceDescription', :jsonValue)`,
          { replacements: { jsonValue } },
        );
      }

      await queryInterface.dropTable('settings_content');
    }
  },
};
