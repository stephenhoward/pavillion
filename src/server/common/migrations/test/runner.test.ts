import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sequelize } from 'sequelize-typescript';
import path from 'path';
import {
  createMigrationRunner,
  runMigrations,
  getPendingMigrations,
  getExecutedMigrations,
} from '../runner';

/**
 * Tests for the migration runner functionality.
 *
 * These tests verify:
 * - Migration discovery and ordering
 * - Migration tracking in SequelizeMeta table
 * - Skipping already-executed migrations
 * - Handling empty migrations directory
 * - Error handling for failed migrations
 *
 * Note: These tests use the actual migrations directory in the test fixtures folder
 * to avoid issues with dynamic imports in vitest's module resolution.
 */
describe('Migration Runner', () => {
  let sequelize: Sequelize;
  const testMigrationsDir = path.join(__dirname, 'fixtures', 'migrations');

  beforeEach(async () => {
    // Create a fresh in-memory SQLite database for each test
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    });
  });

  afterEach(async () => {
    // Close the database connection
    await sequelize.close();
  });

  describe('Migration Discovery and Ordering', () => {
    it('should discover and order migration files correctly', async () => {
      const pending = await getPendingMigrations(sequelize, testMigrationsDir);

      // Should have exactly 3 migrations from fixtures
      expect(pending).toHaveLength(3);
      expect(pending[0]).toBe('0001_first.ts');
      expect(pending[1]).toBe('0002_second.ts');
      expect(pending[2]).toBe('0003_third.ts');
    });
  });

  describe('Migration Tracking in SequelizeMeta Table', () => {
    it('should track executed migrations in SequelizeMeta table', async () => {
      // Run migrations
      const result = await runMigrations(sequelize, testMigrationsDir);

      expect(result.success).toBe(true);
      expect(result.executed).toContain('0001_first.ts');

      // Verify SequelizeMeta table exists and contains the migrations
      const [results] = await sequelize.query('SELECT name FROM SequelizeMeta ORDER BY name');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect((results[0] as any).name).toBe('0001_first.ts');
    });

    it('should return executed migrations via getExecutedMigrations', async () => {
      // Run migrations
      await runMigrations(sequelize, testMigrationsDir);

      const executed = await getExecutedMigrations(sequelize, testMigrationsDir);

      expect(executed).toHaveLength(3);
      expect(executed).toContain('0001_first.ts');
      expect(executed).toContain('0002_second.ts');
      expect(executed).toContain('0003_third.ts');
    });
  });

  describe('Skip Already-Executed Migrations', () => {
    it('should skip already-executed migrations on second run', async () => {
      // Run migrations first time
      let result = await runMigrations(sequelize, testMigrationsDir);
      expect(result.success).toBe(true);
      expect(result.executed).toHaveLength(3);

      // Run migrations again - should skip all
      result = await runMigrations(sequelize, testMigrationsDir);
      expect(result.success).toBe(true);
      expect(result.executed).toHaveLength(0);
    });

    it('should return empty pending array after all migrations are executed', async () => {
      // Run all migrations
      await runMigrations(sequelize, testMigrationsDir);

      const pending = await getPendingMigrations(sequelize, testMigrationsDir);
      expect(pending).toHaveLength(0);
    });
  });

  describe('Empty Migrations Directory', () => {
    it('should handle empty migrations directory gracefully', async () => {
      const emptyDir = path.join(__dirname, 'fixtures', 'empty-migrations');
      const pending = await getPendingMigrations(sequelize, emptyDir);
      expect(pending).toHaveLength(0);

      const result = await runMigrations(sequelize, emptyDir);
      expect(result.success).toBe(true);
      expect(result.executed).toHaveLength(0);
    });

    it('should create migrations directory if it does not exist', async () => {
      // Using a path that will be created by the runner
      const nonExistentDir = path.join(__dirname, 'fixtures', 'temp-created-dir');

      // This should not throw and should create the directory
      const umzug = createMigrationRunner(sequelize, nonExistentDir);
      const pending = await umzug.pending();
      expect(pending).toHaveLength(0);

      // Cleanup
      const fs = await import('fs');
      if (fs.existsSync(nonExistentDir)) {
        fs.rmSync(nonExistentDir, { recursive: true });
      }
    });
  });

  describe('Failed Migration Handling', () => {
    it('should return appropriate error on failed migration', async () => {
      const failingDir = path.join(__dirname, 'fixtures', 'failing-migrations');

      const result = await runMigrations(sequelize, failingDir);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Migration 0001_failing.ts');
    });
  });
});
