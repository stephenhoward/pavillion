import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Sequelize } from 'sequelize-typescript';
import path from 'path';
import fs from 'fs';
import db from '@/server/common/entity/db';
import { runMigrations, createMigrationRunner } from '../../runner';
import { compareSchemas, getTableNames } from './schema-comparator';
import { importAllEntities } from './entity-registry';

const migrationsDir = path.join(process.cwd(), 'migrations');

describe('Migration Schema Validation', () => {

  describe('Migrations produce schema compatible with entities', () => {
    let migrationDb: Sequelize;

    beforeAll(async () => {
      // 1. Run all real migrations on a fresh in-memory SQLite
      migrationDb = new Sequelize({
        dialect: 'sqlite',
        storage: ':memory:',
        logging: false,
      });

      const result = await runMigrations(migrationDb, migrationsDir);
      expect(result.success).toBe(true);

      // 2. Import all entities (registers them on the singleton db)
      //    then sync to create entity-derived schema
      await importAllEntities();
      await db.sync({ force: true });
    });

    afterAll(async () => {
      await migrationDb.close();
    });

    it('should not have tables defined in entities but missing from migrations', async () => {
      const diff = await compareSchemas(migrationDb, db);

      if (diff.missingTables.length > 0) {
        const msg = `Tables defined in entities but missing from migrations:\n` +
          diff.missingTables.map((t) => `  - ${t}`).join('\n') +
          `\n\nCreate a migration to add these tables.`;
        expect.fail(msg);
      }
    });

    it('should not have columns defined in entities but missing from migrations', async () => {
      const diff = await compareSchemas(migrationDb, db);

      if (diff.missingColumns.length > 0) {
        const msg = `Columns defined in entities but missing from migrations:\n` +
          diff.missingColumns.map((c) => `  - ${c.table}.${c.column}`).join('\n') +
          `\n\nCreate a migration to add these columns.`;
        expect.fail(msg);
      }
    });

    it('should not have allowNull or primaryKey constraint mismatches', async () => {
      const diff = await compareSchemas(migrationDb, db);

      if (diff.constraintMismatches.length > 0) {
        const msg = `Constraint mismatches between migrations and entities:\n` +
          diff.constraintMismatches.map((m) =>
            `  - ${m.table}.${m.column}: ${m.field} is ${m.migration} in migration, ${m.entity} in entity`,
          ).join('\n');
        expect.fail(msg);
      }
    });

    it('should warn about extra columns in migrations (deprecated columns)', async () => {
      const diff = await compareSchemas(migrationDb, db);

      if (diff.extraTables.length > 0) {
        console.warn(
          `[WARNING] Tables in migrations but not in entities (may be deprecated):\n` +
          diff.extraTables.map((t) => `  - ${t}`).join('\n'),
        );
      }

      if (diff.extraColumns.length > 0) {
        console.warn(
          `[WARNING] Columns in migrations but not in entities (may be deprecated):\n` +
          diff.extraColumns.map((c) => `  - ${c.table}.${c.column}`).join('\n'),
        );
      }

      // Warnings only — extra columns/tables are not failures
      expect(true).toBe(true);
    });
  });

  describe('Migration file hygiene', () => {
    let migrationFiles: string[];

    beforeAll(() => {
      migrationFiles = fs.readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
        .sort();
    });

    it('should have no duplicate numeric prefixes', () => {
      const prefixes = migrationFiles.map((f) => f.split('_')[0]);
      const seen = new Map<string, string[]>();

      for (let i = 0; i < prefixes.length; i++) {
        const prefix = prefixes[i];
        const existing = seen.get(prefix) || [];
        existing.push(migrationFiles[i]);
        seen.set(prefix, existing);
      }

      const duplicates = [...seen.entries()]
        .filter(([, files]) => files.length > 1);

      if (duplicates.length > 0) {
        const msg = `Duplicate migration prefixes found:\n` +
          duplicates.map(([prefix, files]) =>
            `  ${prefix}: ${files.join(', ')}`,
          ).join('\n') +
          `\n\nRename one of the files to use a unique prefix.`;
        expect.fail(msg);
      }
    });

    it('should export up and down functions from all migration files', async () => {
      const errors: string[] = [];

      for (const file of migrationFiles) {
        const fullPath = path.join(migrationsDir, file);
        const mod = await import(fullPath);
        const migration = mod.default ?? mod;

        if (typeof migration.up !== 'function') {
          errors.push(`${file}: missing 'up' function`);
        }
        if (typeof migration.down !== 'function') {
          errors.push(`${file}: missing 'down' function`);
        }
      }

      if (errors.length > 0) {
        expect.fail(`Migration export errors:\n  ${errors.join('\n  ')}`);
      }
    });

    it('should sort migration files lexicographically by filename', () => {
      const sorted = [...migrationFiles].sort();
      expect(migrationFiles).toEqual(sorted);
    });
  });

  describe('Migrations run cleanly on fresh database', () => {
    let freshDb: Sequelize;

    afterAll(async () => {
      if (freshDb) await freshDb.close();
    });

    it('should run all migrations without errors', async () => {
      freshDb = new Sequelize({
        dialect: 'sqlite',
        storage: ':memory:',
        logging: false,
      });

      const result = await runMigrations(freshDb, migrationsDir);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.executed.length).toBeGreaterThan(0);
    });

    it('should produce core tables after running all migrations', async () => {
      const tables = await getTableNames(freshDb);

      // Verify some essential tables exist
      expect(tables).toContain('account');
      expect(tables).toContain('calendar');
      expect(tables).toContain('event');
      expect(tables).toContain('event_content');
    });
  });

  describe('Migrations are reversible', () => {
    it('should be able to roll back all migrations to empty state', async () => {
      const rollbackDb = new Sequelize({
        dialect: 'sqlite',
        storage: ':memory:',
        logging: false,
      });

      try {
        // Run all migrations up
        const result = await runMigrations(rollbackDb, migrationsDir);
        expect(result.success).toBe(true);

        // Roll all migrations back
        const umzug = createMigrationRunner(rollbackDb, migrationsDir);
        await umzug.down({ to: 0 });

        // Verify database is empty (only SequelizeMeta remains)
        const tables = await getTableNames(rollbackDb);
        expect(tables).toEqual([]);
      }
      finally {
        await rollbackDb.close();
      }
    });
  });
});
