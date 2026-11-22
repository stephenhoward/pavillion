/**
 * The pure pieces of `pavillion backup restore`.
 *
 * Kept out of cli/index.ts because that module runs main() on import, which
 * makes its handlers untestable in-process (see drill-status.ts).
 */

import chalk from 'chalk';

/**
 * Connection settings for the database a restore will overwrite.
 */
export interface RestoreConnection {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

/**
 * Reads the restore target from the `database` config block, applying the
 * same defaults the CLI has always used.
 *
 * @param dbConfig - The `database` config block
 * @returns The connection settings pg_restore will use
 */
export function resolveRestoreConnection(dbConfig: Record<string, any>): RestoreConnection {
  return {
    host: dbConfig.host || 'localhost',
    port: Number(dbConfig.port || 5432),
    database: dbConfig.database,
    username: dbConfig.username || dbConfig.user || 'postgres',
    password: dbConfig.password || '',
  };
}

/**
 * Builds the pg_restore invocation for execFile — no shell is involved.
 *
 * The password travels only in the child's environment, so it never appears
 * in the argument list (which an execFile error echoes back as `cmd`). `--`
 * stops pg_restore reading the backup path as an option.
 *
 * @param conn - The target database connection
 * @param backupPath - Path to the dump file, from the backup's metadata row
 * @returns The argument array and environment for execFile('pg_restore', ...)
 */
export function pgRestoreInvocation(
  conn: RestoreConnection,
  backupPath: string,
): { args: string[]; env: NodeJS.ProcessEnv } {
  return {
    args: [
      '-c',
      '-h', conn.host,
      '-p', String(conn.port),
      '-U', conn.username,
      '-d', conn.database,
      '--', backupPath,
    ],
    env: { ...process.env, PGPASSWORD: conn.password },
  };
}

/**
 * The warning-block line that names the database a restore will replace.
 * Carries no credentials.
 *
 * @param conn - The target database connection
 * @returns The line to print
 */
export function formatRestoreTarget(conn: RestoreConnection): string {
  return `${chalk.cyan('Target database:')} ${conn.database} on ${conn.host}`;
}
