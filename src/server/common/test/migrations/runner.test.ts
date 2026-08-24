import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Sequelize } from 'sequelize-typescript';
import path from 'path';
import cls from 'cls-hooked';
import {
  createMigrationRunner,
  runMigrations,
  getPendingMigrations,
  getExecutedMigrations,
  clearMigrationSessionTimeouts,
} from '@/server/common/migrations/runner';

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

  describe('Session Timeout Exemption', () => {
    // The app's pooled connections carry a 60s statement_timeout, a 60s
    // idle_in_transaction_session_timeout and a 5s lock_timeout
    // (config/default.yaml). Migrations run on that same Sequelize instance, and
    // DDL on a large table can legitimately run, or wait on a table lock, far
    // longer, so the migration transaction clears all three for its own
    // session. SET LOCAL reverts at commit, leaving the pooled setting intact.
    it('clears every session timeout for the migration transaction on postgres', async () => {
      const statements: string[] = [];
      const fakeSequelize = {
        getDialect: () => 'postgres',
        query: async (sql: string) => {
          statements.push(sql);
        },
      };

      await clearMigrationSessionTimeouts(fakeSequelize as unknown as Sequelize);

      expect(statements).toEqual([
        'SET LOCAL statement_timeout = 0',
        'SET LOCAL idle_in_transaction_session_timeout = 0',
        'SET LOCAL lock_timeout = 0',
      ]);
    });

    it('issues no session statements on dialects that do not support them', async () => {
      const statements: string[] = [];
      const fakeSequelize = {
        getDialect: () => 'sqlite',
        query: async (sql: string) => {
          statements.push(sql);
        },
      };

      await clearMigrationSessionTimeouts(fakeSequelize as unknown as Sequelize);

      expect(statements).toEqual([]);
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

    it('should roll back partial DDL changes when a migration fails mid-way', async () => {
      const partialDir = path.join(__dirname, 'fixtures', 'partial-failing-migrations');

      const result = await runMigrations(sequelize, partialDir);

      // Migration failed
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      // The first CREATE TABLE should have been rolled back — the table must not exist
      const [tables] = await sequelize.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='test_atomic_first'",
      );
      expect(tables).toHaveLength(0);
    });
  });
});

describe('Migration Runner session-timeout wiring', () => {
  // Proves the runner actually calls clearMigrationSessionTimeouts, not just
  // that the helper works in isolation. Deleting the call sites in up()/down()
  // leaves every other test green, so these assert on the statement stream the
  // runner emits through the context it hands to migrations.
  //
  // The wrapper is a real SQLite Sequelize with two seams: getDialect() claims
  // postgres so the helper emits its statements, and query() records every
  // statement — swallowing SET LOCAL (SQLite would reject it) and forwarding
  // the rest. Storage, transactions and CLS are the real implementations.
  const probeDir = path.join(__dirname, 'fixtures', 'session-timeout-migrations');
  const namespace = cls.getNamespace('sequelize-migrations')!;

  interface Recorded {
    sql: string;
    inTransaction: boolean;
  }

  let sequelize: Sequelize;
  let recorded: Recorded[];
  let context: Sequelize;

  beforeEach(() => {
    sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
    recorded = [];
    context = new Proxy(sequelize, {
      get(target, prop, receiver) {
        if (prop === 'getDialect') {
          return () => 'postgres';
        }
        if (prop === 'query') {
          return async (sql: string, ...rest: unknown[]) => {
            recorded.push({ sql, inTransaction: Boolean(namespace.get('transaction')) });
            if (sql.startsWith('SET LOCAL')) {
              return [];
            }
            return target.query(sql, ...(rest as []));
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  });

  afterEach(async () => {
    await sequelize.close();
  });

  const setLocalStatements = [
    'SET LOCAL statement_timeout = 0',
    'SET LOCAL idle_in_transaction_session_timeout = 0',
  ];

  const indexOf = (sql: string) => recorded.findIndex((entry) => entry.sql === sql);

  it('clears both session timeouts before the migration body on up()', async () => {
    await createMigrationRunner(context, probeDir).up();

    const sqls = recorded.map((entry) => entry.sql);
    expect(sqls).toEqual(expect.arrayContaining(setLocalStatements));
    for (const statement of setLocalStatements) {
      expect(indexOf(statement)).toBeLessThan(indexOf("SELECT 'migration-body-up'"));
    }
  });

  it('clears both session timeouts before the migration body on down()', async () => {
    const runner = createMigrationRunner(context, probeDir);
    await runner.up();
    recorded = [];

    await runner.down();

    const sqls = recorded.map((entry) => entry.sql);
    expect(sqls).toEqual(expect.arrayContaining(setLocalStatements));
    for (const statement of setLocalStatements) {
      expect(indexOf(statement)).toBeLessThan(indexOf("SELECT 'migration-body-down'"));
    }
  });

  it('issues the SET LOCAL statements inside the migration transaction', async () => {
    // PostgreSQL silently ignores SET LOCAL outside a transaction, so a CLS
    // regression would leave the 60s statement_timeout in force without any
    // error. Assert the transaction is bound when each statement is issued.
    const runner = createMigrationRunner(context, probeDir);
    await runner.up();
    await runner.down();

    const setLocals = recorded.filter((entry) => entry.sql.startsWith('SET LOCAL'));
    expect(setLocals).toHaveLength(4);
    expect(setLocals.every((entry) => entry.inTransaction)).toBe(true);
  });
});
