/**
 * The pure pieces of `pavillion backup restore`.
 *
 * Kept out of cli/index.ts because that module runs main() on import, which
 * makes its handlers untestable in-process (see drill-status.ts).
 */

import chalk from 'chalk';
import * as fs from 'fs';

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
 * stops pg_restore reading the backup path as an option, which matters
 * because `--file` hands it a path the operator typed.
 *
 * `--if-exists` makes `-c`'s DROPs tolerate objects that are not there. Into
 * an empty database, plain `-c` reports an error for every DROP and exits 1
 * even though the restore worked.
 *
 * @param conn - The target database connection
 * @param backupPath - Path to the dump file, from the backup's metadata row or `--file`
 * @returns The argument array and environment for execFile('pg_restore', ...)
 */
export function pgRestoreInvocation(
  conn: RestoreConnection,
  backupPath: string,
): { args: string[]; env: NodeJS.ProcessEnv } {
  return {
    args: [
      '-c',
      '--if-exists',
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

/**
 * The usage rule for `backup restore`: exactly one of a backup ID or
 * `--file <path>`. Checked before anything else, including the terminal check.
 *
 * @param id - The backup ID argument, if given
 * @param file - The `--file` path, if given
 * @returns The usage message, or null when the arguments are valid
 */
export function restoreUsageError(id: string | undefined, file: string | undefined): string | null {
  if (Boolean(id) === Boolean(file)) {
    return 'Give exactly one of a backup ID or --file <path>.\n'
      + 'Usage: pavillion backup restore <id>\n'
      + '       pavillion backup restore --file <path>';
  }
  return null;
}

/**
 * Builds the pg_restore invocation that prints a dump's migration record as
 * SQL on stdout. It reads only the file: no connection, so no password.
 *
 * `--table` is case-sensitive, and the table is "SequelizeMeta".
 *
 * @param dumpPath - Path to the dump file
 * @returns The argument array for execFile('pg_restore', ...)
 */
export function dumpMigrationsInvocation(dumpPath: string): { args: string[] } {
  return { args: ['--data-only', '--table=SequelizeMeta', '--file=-', '--', dumpPath] };
}

const SEQUELIZE_META_COPY = /^COPY public\."SequelizeMeta" \(name\) FROM stdin;$/;

/**
 * Reads the migration names out of the SequelizeMeta COPY block in
 * pg_restore's SQL output. Only the lines between the COPY line and its `\.`
 * terminator are read; PG17 also writes `\restrict` lines and may write other
 * tables' data, none of which is a migration name.
 *
 * @param sql - pg_restore's stdout
 * @returns The names, or null when there is no complete SequelizeMeta block
 */
export function parseDumpMigrations(sql: string): string[] | null {
  const lines = sql.split(/\r?\n/);
  const start = lines.findIndex((line) => SEQUELIZE_META_COPY.test(line));
  if (start === -1) {
    return null;
  }

  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line === '\\.') {
      return names;
    }
    names.push(line);
  }
  return null;
}

/**
 * Lists the migrations this code ships, named as umzug records them in
 * SequelizeMeta (filename, extension included). Mirrors the runner's glob,
 * `*.{js,ts}` without `*.d.ts`.
 *
 * @param dir - The migrations directory
 * @returns The sorted filenames
 */
export function listCodeMigrations(dir: string): string[] {
  return fs.readdirSync(dir)
    .filter((name) => /\.(ts|js)$/.test(name) && !name.endsWith('.d.ts'))
    .sort();
}

/**
 * Compares the code's migrations with a dump's.
 *
 * @param code - Migrations this code ships
 * @param dump - Migrations recorded in the dump
 * @returns `missing`: in the code but not the dump (dump is older);
 *   `extra`: in the dump but not the code (dump is newer). Both sorted.
 */
export function compareMigrationSets(code: string[], dump: string[]): { missing: string[]; extra: string[] } {
  const codeSet = new Set(code);
  const dumpSet = new Set(dump);
  return {
    missing: code.filter((name) => !dumpSet.has(name)).sort(),
    extra: dump.filter((name) => !codeSet.has(name)).sort(),
  };
}

/**
 * C0 controls, DEL and C1 controls. Dump-supplied names reach the terminal,
 * and an escape sequence in one could rewrite what the operator reads before
 * confirming.
 */
// Matching control codepoints is this pattern's whole purpose.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Removes control characters from untrusted text before it is printed.
 *
 * @param text - Text from a dump or an operator-supplied path
 * @returns The text with control characters removed
 */
export function printable(text: string): string {
  return text.replace(CONTROL_CHARS, '');
}

/**
 * Decides whether a dump's migration record lets `--file` proceed.
 *
 * Refuses a dump with no record (not a Pavillion dump, or unreadable) and a
 * dump newer than the code, which would leave a schema the code cannot run.
 * An older dump proceeds: the app migrates it forward when it next starts.
 *
 * @param code - Migrations this code ships
 * @param dump - Migrations read from the dump, or null if none could be read
 * @returns ok, and the lines to print (the refusal, or the warning-block line)
 */
export function checkDumpMigrations(code: string[], dump: string[] | null): { ok: boolean; lines: string[] } {
  if (!dump || dump.length === 0) {
    return {
      ok: false,
      lines: ['[Restore] Refusing: the file is not a Pavillion database dump, or it has no migration record.'],
    };
  }

  const { missing, extra } = compareMigrationSets(code, dump);

  if (extra.length > 0) {
    return {
      ok: false,
      lines: [
        `[Restore] Refusing: the dump has ${extra.length} migration(s) this version of Pavillion does not:`,
        ...extra.map((name) => `  ${printable(name)}`),
        'Restoring it would leave a database this version cannot run. Restore it with the Pavillion',
        'version that made the dump (set PAVILLION_IMAGE_TAG), then upgrade.',
      ],
    };
  }

  if (missing.length > 0) {
    return {
      ok: true,
      lines: [
        `${chalk.cyan('Migrations:')} the dump is ${missing.length} migration(s) behind this version; `
          + 'the app applies them when it next starts.',
      ],
    };
  }

  return { ok: true, lines: [`${chalk.cyan('Migrations:')} match this version (${code.length})`] };
}
