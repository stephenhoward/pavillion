/**
 * check-migration-open-prs.ts — CI guard against this pull request adding a
 * migration whose numeric prefix another open pull request also adds.
 *
 *   **A PR may not add a migration prefix that another open PR adds.**
 *
 * check-migration-prefixes.ts checks only the PR's merge commit, which is
 * main plus this PR. Two open PRs that each add `0046_*` both pass, and
 * whichever merges second puts a duplicate on main, because a pull_request
 * run does not re-fire when main moves. This check closes that gap by
 * comparing the migrations this PR adds with those added by every other
 * open PR.
 *
 * Only collisions involving a file this PR adds are reported; a prefix
 * shared by two other PRs is theirs to resolve. There is deliberately no
 * push-to-main trigger: of any colliding pair, the PR pushed most recently
 * ran its check while the other was open, so it is red. If the green one
 * merges first, the red one stays red until it renumbers; if the red one
 * renumbers, both are green. One red member per pair is enough, so no
 * labels, comments or write permission are needed.
 *
 * The grouping rule is detect() from check-migration-prefixes.ts. A pure
 * `findCollisions()` is split from the gh-backed fetcher and a thin
 * returnable `main()` so the rule and the exit codes are unit-tested with a
 * stub fetcher.
 *
 * Usage (needs GitHub API access, so it is not part of `npm run lint`):
 *   GITHUB_REPOSITORY=owner/repo PR_NUMBER=123 GH_TOKEN=... \
 *     npx tsx scripts/check-migration-open-prs.ts
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { detect } from './check-migration-prefixes';

export interface OtherPr {
  number: number;
  files: string[];
}

export interface Collision {
  prefix: string;
  ownFiles: string[];
  others: { number: number; file: string }[];
}

export interface PrFile {
  filename: string;
  status: string;
}

export interface PrFetcher {
  listOpenPrNumbers(): number[];
  /** Basenames of the migrations the PR adds. */
  listAddedMigrations(prNumber: number): string[];
}

const MIGRATIONS_DIR = 'migrations/';
const ADDING_STATUSES = new Set(['added', 'renamed', 'copied']);

/**
 * Basenames of the files a PR adds directly under migrations/. A renamed
 * file's `filename` is its new name, which is the one that matters.
 */
export function addedMigrationNames(files: PrFile[]): string[] {
  return files
    .filter((f) => ADDING_STATUSES.has(f.status))
    .filter((f) => f.filename.startsWith(MIGRATIONS_DIR))
    .map((f) => f.filename.slice(MIGRATIONS_DIR.length))
    .filter((name) => !name.includes('/'));
}

/**
 * Prefixes shared between this PR's added migrations and another PR's,
 * ordered by prefix. A prefix with no file from this PR is never reported.
 * Another PR adding the very same file name is skipped: that is either the
 * same commit on both branches or an add/add conflict git already reports.
 */
export function findCollisions(own: string[], others: OtherPr[]): Collision[] {
  const entries = others
    .flatMap((pr) => pr.files.map((file) => ({ number: pr.number, file })))
    .filter((e) => !own.includes(e.file));
  const prefixOf = (name: string) => /^(\d+)_/.exec(name)?.[1];

  const shared = detect([...own, ...entries.map((e) => e.file)]);
  const collisions: Collision[] = [];
  for (const { prefix } of shared) {
    const ownFiles = own.filter((name) => prefixOf(name) === prefix).sort();
    const matching = entries
      .filter((e) => prefixOf(e.file) === prefix)
      .sort((a, b) => a.number - b.number || a.file.localeCompare(b.file));
    if (ownFiles.length > 0 && matching.length > 0) {
      collisions.push({ prefix, ownFiles, others: matching });
    }
  }
  return collisions;
}

/** Run `gh api --paginate` with a jq filter that prints one record per line. */
function ghLines(endpoint: string, jq: string): string[] {
  const out = execFileSync('gh', ['api', '--paginate', endpoint, '--jq', jq], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\n').filter((line) => line.length > 0);
}

/** Fetcher backed by the gh CLI (no shell; token comes from GH_TOKEN). */
export function ghFetcher(repository: string): PrFetcher {
  return {
    listOpenPrNumbers: () =>
      ghLines(`repos/${repository}/pulls?state=open&per_page=100`, '.[].number').map(Number),
    listAddedMigrations: (prNumber) =>
      addedMigrationNames(
        ghLines(
          `repos/${repository}/pulls/${prNumber}/files?per_page=100`,
          '.[] | .status + " " + .filename',
        ).map((line) => {
          const space = line.indexOf(' ');
          return { status: line.slice(0, space), filename: line.slice(space + 1) };
        }),
      ),
  };
}

/**
 * CLI entry as a pure function returning the process exit code: 2 on missing
 * or invalid input, 1 on any collision, else 0.
 */
export function main(
  env: Record<string, string | undefined> = process.env,
  fetcher?: PrFetcher,
): number {
  const prNumber = Number(env.PR_NUMBER);
  if (!env.PR_NUMBER || !Number.isInteger(prNumber) || prNumber <= 0) {
    process.stderr.write(
      'Usage: GITHUB_REPOSITORY=owner/repo PR_NUMBER=123 GH_TOKEN=... npx tsx scripts/check-migration-open-prs.ts\n'
      + 'PR_NUMBER must be the pull request number to check.\n',
    );
    return 2;
  }
  if (!fetcher && !env.GITHUB_REPOSITORY) {
    process.stderr.write('check-migration-open-prs: GITHUB_REPOSITORY is required (owner/repo).\n');
    return 2;
  }
  const source = fetcher ?? ghFetcher(env.GITHUB_REPOSITORY as string);

  const own = source.listAddedMigrations(prNumber);
  const otherNumbers = source.listOpenPrNumbers().filter((n) => n !== prNumber);
  const others = otherNumbers.map((n) => ({ number: n, files: source.listAddedMigrations(n) }));
  const collisions = findCollisions(own, others);

  for (const c of collisions) {
    const theirs = c.others.map((o) => `#${o.number} adds ${o.file}`).join('; ');
    process.stderr.write(`Migration prefix ${c.prefix}: this PR adds ${c.ownFiles.join(', ')}; ${theirs}\n`);
  }
  if (collisions.length > 0) {
    process.stderr.write(
      `\ncheck-migration-open-prs: ${collisions.length} prefix(es) also added by another open PR. `
      + 'Renumber this PR\'s migration.\n',
    );
    return 1;
  }
  process.stdout.write(`check-migration-open-prs: checked against ${otherNumbers.length} open PR(s), no shared prefixes.\n`);
  return 0;
}

// Run only when invoked directly (not when imported by the test).
if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  process.exit(main());
}
