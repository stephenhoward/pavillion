/**
 * Migration smoke test against PostgreSQL.
 *
 * Runs all migrations up, then all migrations down, against a real
 * PostgreSQL instance. Catches dialect-specific issues (e.g. missing
 * USING casts, unsupported ALTER syntax) that SQLite tests miss.
 *
 * Expects DB connection via environment variables:
 *   DB_DIALECT=postgres DB_HOST=localhost DB_PORT=5432
 *   DB_NAME=pavillion_migrate_test DB_USER=pavillion DB_PASSWORD=testpassword
 *
 * Usage:
 *   npx tsx scripts/test-migrations-pg.ts
 */
import { Sequelize } from 'sequelize-typescript';
import { createMigrationRunner } from '../src/server/common/migrations/runner.js';
import path from 'path';

async function main() {
  const dialect = process.env.DB_DIALECT ?? 'postgres';
  if (dialect !== 'postgres') {
    console.error(`This script must run against PostgreSQL (got dialect="${dialect}")`);
    process.exit(1);
  }

  const sequelize = new Sequelize({
    dialect: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? 'pavillion_migrate_test',
    username: process.env.DB_USER ?? 'pavillion',
    password: process.env.DB_PASSWORD ?? 'testpassword',
    logging: false,
  });

  const migrationsPath = path.join(process.cwd(), 'migrations');
  const umzug = createMigrationRunner(sequelize, migrationsPath);

  try {
    // Verify connection
    await sequelize.authenticate();
    console.log('Connected to PostgreSQL');

    // Run all migrations up
    console.log('Running migrations UP...');
    const upResult = await umzug.up();
    console.log(`  ${upResult.length} migration(s) applied`);

    // Run all migrations down (in reverse)
    console.log('Running migrations DOWN...');
    const downResult = await umzug.down({ to: 0 });
    console.log(`  ${downResult.length} migration(s) reverted`);

    console.log('Migration smoke test passed');
  }
  catch (error) {
    console.error('Migration smoke test FAILED:', error);
    process.exit(1);
  }
  finally {
    await sequelize.close();
  }
}

main();
