import { Umzug, SequelizeStorage } from 'umzug';
import { Sequelize } from 'sequelize-typescript';
import path from 'path';
import fs from 'fs';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('migrations');

/**
 * Result of a migration run.
 */
export interface MigrationResult {
  success: boolean;
  executed: string[];
  pending: string[];
  error?: Error;
}

/**
 * Creates and configures the Umzug migration runner.
 *
 * @param sequelize - The Sequelize instance to use for migrations
 * @param migrationsPath - Path to the migrations directory
 * @returns Configured Umzug instance
 */
export function createMigrationRunner(
  sequelize: Sequelize,
  migrationsPath: string = path.join(process.cwd(), 'migrations'),
): Umzug<Sequelize> {
  // Ensure migrations directory exists
  if (!fs.existsSync(migrationsPath)) {
    fs.mkdirSync(migrationsPath, { recursive: true });
  }

  return new Umzug({
    migrations: {
      glob: ['*.{js,ts}', { cwd: migrationsPath, ignore: ['*.d.ts'] }],
      resolve: ({ name, path: migrationPath, context }) => {
        // Handle both ES modules and CommonJS
        const getModule = async () => {
          const module = await import(migrationPath!);
          return module.default ?? module;
        };

        return {
          name,
          up: async () => {
            const migration = await getModule();
            return migration.up({ context });
          },
          down: async () => {
            const migration = await getModule();
            return migration.down({ context });
          },
        };
      },
    },
    context: sequelize,
    storage: new SequelizeStorage({ sequelize }),
    logger,
  });
}

/**
 * Runs all pending migrations.
 *
 * @param sequelize - The Sequelize instance to use for migrations
 * @param migrationsPath - Optional path to the migrations directory
 * @returns Result of the migration run
 */
export async function runMigrations(
  sequelize: Sequelize,
  migrationsPath?: string,
): Promise<MigrationResult> {
  const umzug = createMigrationRunner(sequelize, migrationsPath);

  try {
    // Get pending migrations before running
    const pending = await umzug.pending();
    const pendingNames = pending.map((m) => m.name);

    if (pendingNames.length === 0) {
      logger.info('No pending migrations to run');
      return {
        success: true,
        executed: [],
        pending: [],
      };
    }

    logger.info({ count: pendingNames.length, migrations: pendingNames }, 'Pending migrations found');

    // Run all pending migrations
    const executed = await umzug.up();
    const executedNames = executed.map((m) => m.name);

    logger.info({ count: executedNames.length }, 'Migrations executed successfully');

    return {
      success: true,
      executed: executedNames,
      pending: [],
    };
  }
  catch (error) {
    logger.error({ err: error }, 'Migration failed');
    return {
      success: false,
      executed: [],
      pending: [],
      error: error as Error,
    };
  }
}

/**
 * Gets all pending migrations without running them.
 *
 * @param sequelize - The Sequelize instance to use
 * @param migrationsPath - Optional path to the migrations directory
 * @returns Array of pending migration names
 */
export async function getPendingMigrations(
  sequelize: Sequelize,
  migrationsPath?: string,
): Promise<string[]> {
  const umzug = createMigrationRunner(sequelize, migrationsPath);
  const pending = await umzug.pending();
  return pending.map((m) => m.name);
}

/**
 * Gets all executed migrations.
 *
 * @param sequelize - The Sequelize instance to use
 * @param migrationsPath - Optional path to the migrations directory
 * @returns Array of executed migration names
 */
export async function getExecutedMigrations(
  sequelize: Sequelize,
  migrationsPath?: string,
): Promise<string[]> {
  const umzug = createMigrationRunner(sequelize, migrationsPath);
  const executed = await umzug.executed();
  return executed.map((m) => m.name);
}
