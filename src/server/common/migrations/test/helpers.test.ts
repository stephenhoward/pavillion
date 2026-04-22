import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sequelize, DataTypes } from 'sequelize';
import {
  addIndexIfNotExists,
  columnExists,
  tableExists,
} from '../helpers';

/**
 * Tests for migration helpers.
 *
 * Uses an in-memory SQLite database to verify idempotent helper behavior.
 */
describe('Migration Helpers', () => {
  let sequelize: Sequelize;

  beforeEach(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    });
    // Create a simple table to exercise helpers against.
    await sequelize.getQueryInterface().createTable('widget', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      owner_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
    });
  });

  afterEach(async () => {
    await sequelize.close();
  });

  describe('tableExists', () => {
    it('returns true when the table exists', async () => {
      const qi = sequelize.getQueryInterface();
      expect(await tableExists(qi, 'widget')).toBe(true);
    });

    it('returns false when the table does not exist', async () => {
      const qi = sequelize.getQueryInterface();
      expect(await tableExists(qi, 'nonexistent_table')).toBe(false);
    });
  });

  describe('columnExists', () => {
    it('returns true when the column exists', async () => {
      const qi = sequelize.getQueryInterface();
      expect(await columnExists(qi, 'widget', 'owner_id')).toBe(true);
    });

    it('returns false when the column does not exist', async () => {
      const qi = sequelize.getQueryInterface();
      expect(await columnExists(qi, 'widget', 'nonexistent_column')).toBe(false);
    });
  });

  describe('addIndexIfNotExists', () => {
    it('creates the index when it does not yet exist', async () => {
      const qi = sequelize.getQueryInterface();

      await addIndexIfNotExists(qi, 'widget', ['owner_id'], {
        name: 'idx_widget_owner_id',
      });

      const indexes = await qi.showIndex('widget') as { name: string }[];
      expect(indexes.some((ix) => ix.name === 'idx_widget_owner_id')).toBe(true);
    });

    it('is a no-op when an index with the same name already exists', async () => {
      const qi = sequelize.getQueryInterface();

      // Create the index once.
      await addIndexIfNotExists(qi, 'widget', ['owner_id'], {
        name: 'idx_widget_owner_id',
      });

      const indexesBefore = await qi.showIndex('widget') as { name: string }[];
      const countBefore = indexesBefore.filter(
        (ix) => ix.name === 'idx_widget_owner_id',
      ).length;
      expect(countBefore).toBe(1);

      // Call again — should not throw and should not create a duplicate.
      await addIndexIfNotExists(qi, 'widget', ['owner_id'], {
        name: 'idx_widget_owner_id',
      });

      const indexesAfter = await qi.showIndex('widget') as { name: string }[];
      const countAfter = indexesAfter.filter(
        (ix) => ix.name === 'idx_widget_owner_id',
      ).length;
      expect(countAfter).toBe(1);
    });

    it('supports unique indexes', async () => {
      const qi = sequelize.getQueryInterface();

      await addIndexIfNotExists(qi, 'widget', ['owner_id', 'name'], {
        name: 'uniq_widget_owner_name',
        unique: true,
      });

      const indexes = await qi.showIndex('widget') as {
        name: string;
        unique?: boolean;
      }[];
      const found = indexes.find((ix) => ix.name === 'uniq_widget_owner_name');
      expect(found).toBeDefined();
      expect(found?.unique).toBe(true);
    });

    it('no-ops for an already-created unique index across reruns', async () => {
      const qi = sequelize.getQueryInterface();

      await addIndexIfNotExists(qi, 'widget', ['owner_id', 'name'], {
        name: 'uniq_widget_owner_name',
        unique: true,
      });

      // Rerun — should not throw (which a raw addIndex would, due to duplicate).
      await expect(
        addIndexIfNotExists(qi, 'widget', ['owner_id', 'name'], {
          name: 'uniq_widget_owner_name',
          unique: true,
        }),
      ).resolves.toBeUndefined();

      const indexes = await qi.showIndex('widget') as { name: string }[];
      const count = indexes.filter(
        (ix) => ix.name === 'uniq_widget_owner_name',
      ).length;
      expect(count).toBe(1);
    });
  });
});
