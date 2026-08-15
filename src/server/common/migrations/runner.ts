import { Umzug, SequelizeStorage } from 'umzug';
import { Sequelize } from 'sequelize-typescript';
import cls from 'cls-hooked';
import path from 'path';
import fs from 'fs';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('migrations');

/**
 * Enable Sequelize CLS (continuation-local storage) so that queries issued
 * inside a `sequelize.transaction()` callback automatically enroll in that
 * transaction without needing to thread `{ transaction }` through every call.
 *
 * This must be called before any Sequelize transaction is started. Calling
 * it multiple times with the same namespace is a no-op.
 *
 * CLS only affects queries issued inside a transaction callback; code that
 * doesn't use transactions is unaffected.
 */
const MIGRATION_CLS_NAMESPACE = 'sequelize-migrations';
const namespace = cls.createNamespace(MIGRATION_CLS_NAMESPACE);
(Sequelize as unknown as { useCLS: (ns: cls.Namespace) => void }).useCLS(namespace);

/**
 * Removes the per-connection session limits for the current transaction.
 *
 * The application's PostgreSQL connections carry a 60s `statement_timeout` and
 * `idle_in_transaction_session_timeout` (see the `database.dialectOptions` block
 * in `config/default.yaml`), which bound how long a request can pin a pooled
 * connection. Migrations run through the same Sequelize instance and the same
 * pool, but schema changes on a large table can legitimately run far longer than
 * any request should — so the migration transaction opts itself out.
 *
 * `SET LOCAL` scopes the change to the enclosing transaction and reverts on
 * commit or rollback, so the connection returns to the pool with the configured
 * limits intact. Must therefore be called from inside a transaction.
 *
 * Non-PostgreSQL dialects have neither setting; the call is a no-op there.
 *
 * @param sequelize - The Sequelize instance running the migration transaction
 */
export async function clearMigrationSessionTimeouts(sequelize: Sequelize): Promise<void> {
  if (sequelize.getDialect() !== 'postgres') {
    return;
  }

  await sequelize.query('SET LOCAL statement_timeout = 0');
  await sequelize.query('SET LOCAL idle_in_transaction_session_timeout = 0');
}

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
            // Wrap the migration in a transaction so partial failures roll back
            // cleanly instead of leaving the schema in a half-applied state.
            // CLS auto-enrolls all queries inside the callback.
            return context.transaction(async () => {
              await clearMigrationSessionTimeouts(context);
              return migration.up({ context });
            });
          },
          down: async () => {
            const migration = await getModule();
            return context.transaction(async () => {
              await clearMigrationSessionTimeouts(context);
              return migration.down({ context });
            });
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
