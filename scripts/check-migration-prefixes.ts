/**
 * check-migration-prefixes.ts — CI guard against two migrations sharing a
 * numeric prefix.
 *
 *   **No two files in migrations/ may begin with the same `NNNN_` prefix.**
 *
 * Git cannot see this collision. `0046_foo.ts` on one branch and
 * `0046_bar.ts` on another are different paths, so they merge cleanly and
 * the duplicate surfaces only after the merge lands. The check therefore
 * runs against the tree as checked out: in a pull_request workflow the
 * default checkout is the merge commit, so it sees base and head together
 * with no fork-point logic and no extra fetch depth.
 *
 * Only names with a leading run of digits followed by `_` count as
 * migrations; migrations/README.md and anything else is ignored.
 *
 * A pure `detect(fileNames) -> Duplicate[]` is split from a thin returnable
 * `main()` so both the rule and the exit-code behavior are unit-tested.
 *
 * Usage:
 *   npx tsx scripts/check-migration-prefixes.ts [migrationsDir]
 *   # defaults to migrations/ at the repo root
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface Duplicate {
  prefix: string;
  files: string[];
}

const MIGRATION_NAME = /^(\d+)_/;

/**
 * Group file names by numeric prefix and return every prefix shared by more
 * than one file, ordered by prefix, with filenames sorted.
 */
export function detect(fileNames: string[]): Duplicate[] {
  const byPrefix = new Map<string, string[]>();
  for (const name of fileNames) {
    const match = MIGRATION_NAME.exec(name);
    if (!match) {
      continue;
    }
    const group = byPrefix.get(match[1]) ?? [];
    group.push(name);
    byPrefix.set(match[1], group);
  }

  return [...byPrefix.entries()]
    .filter(([, files]) => files.length > 1)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prefix, files]) => ({ prefix, files: [...files].sort() }));
}

/** Names of the regular files directly inside `dir`. */
export function listMigrationFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

/**
 * CLI entry as a pure function returning the process exit code (1 on any
 * duplicated prefix, else 0).
 */
export function main(argv: string[] = process.argv.slice(2)): number {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dir = path.resolve(argv[0] ?? path.join(repoRoot, 'migrations'));
  const files = listMigrationFiles(dir);
  const duplicates = detect(files);

  for (const dup of duplicates) {
    process.stderr.write(`Migration prefix ${dup.prefix} is shared by: ${dup.files.join(', ')}\n`);
  }

  if (duplicates.length > 0) {
    process.stderr.write(`\ncheck-migration-prefixes: ${duplicates.length} duplicated prefix(es) found.\n`);
    return 1;
  }
  process.stdout.write(`check-migration-prefixes: no duplicated prefixes in ${files.length} file(s).\n`);
  return 0;
}

// Run only when invoked directly (not when imported by the test).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main());
}
