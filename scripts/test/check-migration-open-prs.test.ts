import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  findCollisions,
  addedMigrationNames,
  main,
  type PrFetcher,
} from '../check-migration-open-prs';

describe('check-migration-open-prs: findCollisions', () => {
  it('reports a prefix this PR shares with another open PR, naming the PR and file', () => {
    const result = findCollisions(
      ['0046_mine.ts'],
      [{ number: 123, files: ['0046_theirs.ts'] }],
    );
    expect(result).toEqual([
      {
        prefix: '0046',
        ownFiles: ['0046_mine.ts'],
        others: [{ number: 123, file: '0046_theirs.ts' }],
      },
    ]);
  });

  it('does not report a prefix shared only between two other PRs', () => {
    const result = findCollisions(
      ['0047_mine.ts'],
      [
        { number: 1, files: ['0046_a.ts'] },
        { number: 2, files: ['0046_b.ts'] },
      ],
    );
    expect(result).toEqual([]);
  });

  it('lists every other PR in one entry when a prefix is shared with two of them', () => {
    const result = findCollisions(
      ['0046_mine.ts'],
      [
        { number: 2, files: ['0046_b.ts'] },
        { number: 1, files: ['0046_a.ts'] },
      ],
    );
    expect(result).toHaveLength(1);
    expect(result[0].others).toEqual([
      { number: 1, file: '0046_a.ts' },
      { number: 2, file: '0046_b.ts' },
    ]);
  });

  it('reports each colliding prefix separately, in prefix order', () => {
    const result = findCollisions(
      ['0050_mine.ts', '0046_mine.ts'],
      [{ number: 7, files: ['0046_x.ts', '0050_y.ts', '0051_z.ts'] }],
    );
    expect(result.map((c) => c.prefix)).toEqual(['0046', '0050']);
  });

  it('skips another PR that adds the same file name, which git already handles', () => {
    expect(findCollisions(
      ['0046_same.ts'],
      [{ number: 9, files: ['0046_same.ts'] }],
    )).toEqual([]);
  });

  it('still reports a different name on the same prefix beside an identical one', () => {
    const result = findCollisions(
      ['0046_same.ts'],
      [{ number: 9, files: ['0046_same.ts'] }, { number: 12, files: ['0046_other.ts'] }],
    );
    expect(result).toEqual([
      {
        prefix: '0046',
        ownFiles: ['0046_same.ts'],
        others: [{ number: 12, file: '0046_other.ts' }],
      },
    ]);
  });

  it('ignores files without a numeric migration prefix', () => {
    expect(
      findCollisions(['README.md'], [{ number: 1, files: ['README.md'] }]),
    ).toEqual([]);
  });

  it('reports nothing when this PR adds no migration', () => {
    expect(findCollisions([], [{ number: 1, files: ['0046_a.ts'] }])).toEqual([]);
  });
});

describe('check-migration-open-prs: addedMigrationNames', () => {
  it('keeps added, renamed and copied files under migrations/ as basenames', () => {
    const result = addedMigrationNames([
      { filename: 'migrations/0046_a.ts', status: 'added' },
      { filename: 'migrations/0047_b.ts', status: 'renamed' },
      { filename: 'migrations/0048_c.ts', status: 'copied' },
    ]);
    expect(result).toEqual(['0046_a.ts', '0047_b.ts', '0048_c.ts']);
  });

  it('drops modified and removed migrations', () => {
    expect(
      addedMigrationNames([
        { filename: 'migrations/0001_a.ts', status: 'modified' },
        { filename: 'migrations/0002_b.ts', status: 'removed' },
      ]),
    ).toEqual([]);
  });

  it('drops files outside migrations/ and nested paths', () => {
    expect(
      addedMigrationNames([
        { filename: 'src/server/0046_a.ts', status: 'added' },
        { filename: 'docs/migrations/0046_b.ts', status: 'added' },
        { filename: 'migrations/sub/0046_c.ts', status: 'added' },
      ]),
    ).toEqual([]);
  });
});

describe('check-migration-open-prs: main', () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const env = { GITHUB_REPOSITORY: 'o/r', PR_NUMBER: '10' };

  const fetcherFor = (files: Record<number, string[]>): PrFetcher => ({
    listOpenPrNumbers: () => Object.keys(files).map(Number),
    listAddedMigrations: (n) => files[n] ?? [],
  });

  it('returns 1 and names the other PR and its file on a collision', () => {
    const code = main(env, fetcherFor({ 10: ['0046_mine.ts'], 11: ['0046_theirs.ts'] }));
    expect(code).toBe(1);
    const output = stderr.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('Migration prefix 0046');
    expect(output).toContain('0046_mine.ts');
    expect(output).toContain('#11');
    expect(output).toContain('0046_theirs.ts');
  });

  it('returns 0 when the only collision is between two other PRs', () => {
    const code = main(
      env,
      fetcherFor({ 10: ['0047_mine.ts'], 11: ['0046_a.ts'], 12: ['0046_b.ts'] }),
    );
    expect(code).toBe(0);
  });

  it('excludes this PR from the others and reports how many PRs it checked', () => {
    const code = main(env, fetcherFor({ 10: ['0046_mine.ts'], 11: [], 12: [] }));
    expect(code).toBe(0);
    const output = stdout.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('checked against 2 open PR(s)');
  });

  it('returns 2 with a usage message when PR_NUMBER is missing', () => {
    const code = main({ GITHUB_REPOSITORY: 'o/r' }, fetcherFor({}));
    expect(code).toBe(2);
    expect(stderr.mock.calls.map((c) => String(c[0])).join('')).toContain('PR_NUMBER');
  });

  it('returns 2 when PR_NUMBER is not a number', () => {
    expect(main({ ...env, PR_NUMBER: 'abc' }, fetcherFor({}))).toBe(2);
  });

  it('returns 2 when GITHUB_REPOSITORY is missing and no fetcher is injected', () => {
    expect(main({ PR_NUMBER: '10' })).toBe(2);
  });
});
