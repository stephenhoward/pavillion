import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sequelize, DataTypes } from 'sequelize';
import migration from '../../../../../migrations/0045_add_image_alt_to_content_tables';

/**
 * Migration 0045 adds a nullable `image_alt TEXT` column to all three content
 * tables at once. The risk this test covers is a partial migration: the column
 * landing on `event_content` but not on the series or calendar tables, which
 * would leave alt text silently unsaveable for two of the three parents while
 * every model-layer test still passed.
 *
 * `down` is asserted per table for the same reason — an asymmetric down leaves
 * a rolled-back instance with a column its entities no longer declare.
 */
describe('Migration 0045: add image_alt to content tables', () => {
  const tables = ['event_content', 'event_series_content', 'calendar_content'];
  let sequelize: Sequelize;

  beforeEach(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    });

    // Minimal pre-0045 content tables. Only the columns the migration has to
    // coexist with matter; the migration's sole job is to add `image_alt`.
    for (const table of tables) {
      await sequelize.getQueryInterface().createTable(table, {
        id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
        language: { type: DataTypes.STRING, allowNull: false },
        name: { type: DataTypes.STRING, allowNull: true },
        description: { type: DataTypes.TEXT, allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false },
        updatedAt: { type: DataTypes.DATE, allowNull: false },
      });
    }
  });

  afterEach(async () => {
    await sequelize.close();
  });

  async function hasImageAlt(table: string): Promise<boolean> {
    const description = await sequelize.getQueryInterface().describeTable(table);
    return 'image_alt' in description;
  }

  it('adds a nullable image_alt column to every content table', async () => {
    await migration.up({ context: sequelize });

    for (const table of tables) {
      const description = await sequelize.getQueryInterface().describeTable(table);
      expect(description.image_alt, `${table}.image_alt`).toBeDefined();
      // Null and empty string both mean "no alt in this language", so existing
      // rows must be allowed to carry no value rather than be backfilled.
      expect(description.image_alt.allowNull, `${table}.image_alt allowNull`).toBe(true);
    }
  });

  it('down removes image_alt from every content table', async () => {
    await migration.up({ context: sequelize });
    await migration.down({ context: sequelize });

    for (const table of tables) {
      expect(await hasImageAlt(table), `${table}.image_alt`).toBe(false);
    }
  });

  it('is idempotent on a second up run', async () => {
    await migration.up({ context: sequelize });
    await migration.up({ context: sequelize });

    for (const table of tables) {
      expect(await hasImageAlt(table), `${table}.image_alt`).toBe(true);
    }
  });

  it('down is idempotent when the column is already absent', async () => {
    await migration.down({ context: sequelize });

    for (const table of tables) {
      expect(await hasImageAlt(table), `${table}.image_alt`).toBe(false);
    }
  });
});
