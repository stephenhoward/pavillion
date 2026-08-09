/**
 * Unit tests for .claude/tools/lib/git-cleanup.ts
 *
 * Pure functions are tested directly with canned command output. I/O
 * orchestration functions inject fake spawn/fs deps (later tasks).
 */

import { describe, it, expect } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import {
  parseBranchRefs,
  parseWorktrees,
  worktreeFamily,
  parseOriginUrl,
  buildPrQuery,
  parsePrResponse,
  chunk,
} from '../lib/git-cleanup.js';
import {
  classifyBranch,
  contentEquivalence,
  type BranchInfo,
  type PrInfo,
} from '../lib/git-cleanup.js';

// =============================================================================
// Test helpers (copied from test/stack.test.ts — canonical fakeSpawn/seqSpawn
// pattern for CLI-calling functions under test).
// =============================================================================

function fakeSpawn(
  stdout: string,
  stderr = '',
  status = 0,
): SpawnSyncReturns<Buffer> {
  return {
    stdout: Buffer.from(stdout, 'utf-8'),
    stderr: Buffer.from(stderr, 'utf-8'),
    status,
    signal: null,
    pid: 1234,
    output: [null, Buffer.from(stdout), Buffer.from(stderr)],
  };
}

/** Build a sequential spawn mock that returns results in order. */
function seqSpawn(...results: SpawnSyncReturns<Buffer>[]) {
  let i = 0;
  return (_cmd: string, _args: string[], _opts: unknown) => {
    return results[i++] ?? fakeSpawn('', 'unexpected call', 1);
  };
}

describe('parseBranchRefs', () => {
  // git for-each-ref refs/heads --format='%(refname:short)%09%(objectname)%09%(upstream:short)%09%(upstream:track)'
  it('parses branch, sha, upstream, and gone status', () => {
    const output = [
      'main\tabc123\torigin/main\t\t2026-08-07',
      'feat.done\tdef456\torigin/feat.done\t[gone]\t2026-07-15',
      'local-only\t789abc\t\t\t2025-11-02',
      'ahead\t111222\torigin/ahead\t[ahead 2]\t2026-08-01',
    ].join('\n');
    const refs = parseBranchRefs(output);
    expect(refs).toHaveLength(4);
    expect(refs[0]).toEqual({
      name: 'main', sha: 'abc123', upstream: 'origin/main', upstreamGone: false, lastCommitDate: '2026-08-07',
    });
    expect(refs[1]).toEqual({
      name: 'feat.done', sha: 'def456', upstream: 'origin/feat.done', upstreamGone: true, lastCommitDate: '2026-07-15',
    });
    expect(refs[2]).toEqual({
      name: 'local-only', sha: '789abc', upstream: null, upstreamGone: false, lastCommitDate: '2025-11-02',
    });
    expect(refs[3].upstreamGone).toBe(false);
  });

  it('tolerates a missing committer-date field', () => {
    expect(parseBranchRefs('solo\tabc\t\t')[0].lastCommitDate).toBe('');
  });

  it('returns empty array for empty output', () => {
    expect(parseBranchRefs('')).toEqual([]);
  });
});

describe('parseWorktrees', () => {
  it('parses porcelain blocks including locked and detached', () => {
    const output = [
      'worktree /Users/x/repo',
      'HEAD aaa111',
      'branch refs/heads/main',
      '',
      'worktree /Users/x/.superset/worktrees/uuid/foo',
      'HEAD bbb222',
      'branch refs/heads/foo',
      'locked started by agent',
      '',
      'worktree /Users/x/repo/.claude/worktrees/agent-1',
      'HEAD ccc333',
      'detached',
      '',
    ].join('\n');
    const wts = parseWorktrees(output);
    expect(wts).toHaveLength(3);
    expect(wts[0]).toEqual({ path: '/Users/x/repo', sha: 'aaa111', branch: 'main', locked: false, prunable: false });
    expect(wts[1].locked).toBe(true);
    expect(wts[1].branch).toBe('foo');
    expect(wts[2].branch).toBeNull();
  });
});

describe('worktreeFamily', () => {
  it('classifies the three known families and other', () => {
    expect(worktreeFamily('/Users/x/.superset/worktrees/uuid/foo')).toBe('superset');
    expect(worktreeFamily('/Users/x/repo/.claude/worktrees/agent-a1')).toBe('agent');
    expect(worktreeFamily('/Users/x/pavillion/pv-jdot-chains/chain-b')).toBe('chain');
    expect(worktreeFamily('/Users/x/somewhere/else')).toBe('other');
  });

  // Regression: matching one hard-coded chain directory left every other
  // epic's chain worktrees in 'other', where execute can never act on them.
  it('matches any pv-<epic>-chains directory, not just pv-jdot-chains', () => {
    expect(worktreeFamily('/Users/x/pavillion/pv-federation-chains/chain-a')).toBe('chain');
    expect(worktreeFamily('/Users/x/pavillion/pv-next-epic-chains/chain-a')).toBe('chain');
    expect(worktreeFamily('/Users/x/pavillion/pv-chains/chain-a')).toBe('other');
  });
});

describe('parseOriginUrl', () => {
  it('parses ssh and https remote urls', () => {
    expect(parseOriginUrl('git@github.com:stephenhoward/pavillion.git'))
      .toEqual({ owner: 'stephenhoward', repo: 'pavillion' });
    expect(parseOriginUrl('https://github.com/stephenhoward/pavillion.git'))
      .toEqual({ owner: 'stephenhoward', repo: 'pavillion' });
    expect(parseOriginUrl('https://github.com/stephenhoward/pavillion'))
      .toEqual({ owner: 'stephenhoward', repo: 'pavillion' });
    expect(parseOriginUrl('not-a-url')).toBeNull();
  });
});

describe('buildPrQuery', () => {
  it('aliases one pullRequests field per branch', () => {
    const q = buildPrQuery(['feat.a', 'fix/b'], 'me', 'repo');
    expect(q).toContain('repository(owner: "me", name: "repo")');
    expect(q).toContain('b0: pullRequests(headRefName: "feat.a"');
    expect(q).toContain('b1: pullRequests(headRefName: "fix/b"');
    expect(q).toContain('states: [OPEN, MERGED, CLOSED]');
  });

  it('escapes quotes in branch names', () => {
    const q = buildPrQuery(['we"ird'], 'me', 'repo');
    expect(q).toContain('headRefName: "we\\"ird"');
  });
});

describe('parsePrResponse', () => {
  it('maps aliases back to branch names', () => {
    const json = {
      data: {
        repository: {
          b0: { nodes: [{ number: 7, state: 'MERGED', headRefOid: 'abc' }] },
          b1: { nodes: [] },
        },
      },
    };
    const map = parsePrResponse(json, ['feat.a', 'fix/b']);
    expect(map.get('feat.a')).toEqual([{ number: 7, state: 'MERGED', headRefOid: 'abc' }]);
    expect(map.get('fix/b')).toEqual([]);
  });

  it('marks every branch lookup-failed on malformed response', () => {
    const map = parsePrResponse({ errors: [{ message: 'boom' }] }, ['a', 'b']);
    expect(map.get('a')).toBe('lookup-failed');
    expect(map.get('b')).toBe('lookup-failed');
  });
});

describe('chunk', () => {
  it('splits into fixed-size chunks', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

function branch(over: Partial<BranchInfo> = {}): BranchInfo {
  return {
    name: 'b', sha: 'aaa', upstream: 'origin/b', upstreamGone: false,
    lastCommitDate: '2026-01-01', ...over,
  };
}
/** contentEquivalence() verdict for a branch whose work is already in main. */
const equivalent = { equivalent: true, touchedCount: 3 };
const notEquivalent = { equivalent: false, touchedCount: 3 };
function pr(over: Partial<PrInfo> = {}): PrInfo {
  return { number: 1, state: 'MERGED', headRefOid: 'aaa', ...over };
}

describe('classifyBranch', () => {
  it('ancestor with upstream → merged-ancestor', () => {
    expect(classifyBranch(branch(), true, 0, null).category).toBe('merged-ancestor');
  });

  it('ancestor with gone upstream → merged-ancestor', () => {
    expect(classifyBranch(branch({ upstreamGone: true }), true, 0, null).category).toBe('merged-ancestor');
  });

  it('ancestor with no upstream → empty', () => {
    expect(classifyBranch(branch({ upstream: null }), true, 0, null).category).toBe('empty');
  });

  it('non-ancestor with MERGED PR at branch tip → merged-pr', () => {
    const c = classifyBranch(branch(), false, 3, [pr()]);
    expect(c.category).toBe('merged-pr');
    expect(c.reason).toContain('#1');
  });

  it('non-ancestor MERGED PR but tip moved past it → doubt (ahead of merged PR)', () => {
    const c = classifyBranch(branch({ sha: 'bbb' }), false, 5, [pr({ headRefOid: 'aaa' })]);
    expect(c.category).toBe('doubt');
    expect(c.reason).toContain('ahead of merged PR');
  });

  it('OPEN PR → doubt', () => {
    const c = classifyBranch(branch(), false, 2, [pr({ state: 'OPEN' })]);
    expect(c.category).toBe('doubt');
    expect(c.reason).toContain('open PR');
  });

  it('only CLOSED PRs → doubt (closed without merging)', () => {
    const c = classifyBranch(branch(), false, 2, [pr({ state: 'CLOSED' })]);
    expect(c.category).toBe('doubt');
    expect(c.reason).toContain('closed without merging');
  });

  it('gone upstream, unique commits, no PR → doubt', () => {
    const c = classifyBranch(branch({ upstreamGone: true }), false, 4, []);
    expect(c.category).toBe('doubt');
    expect(c.reason).toContain('4');
  });

  it('no upstream, unique commits → doubt', () => {
    const c = classifyBranch(branch({ upstream: null }), false, 2, []);
    expect(c.category).toBe('doubt');
    expect(c.reason).toContain('no upstream');
  });

  it('lookup failure → doubt, never merged', () => {
    const c = classifyBranch(branch(), false, 1, 'lookup-failed');
    expect(c.category).toBe('doubt');
    expect(c.reason).toContain('lookup failed');
  });

  it('a MERGED PR at tip wins over an older CLOSED PR', () => {
    const c = classifyBranch(branch(), false, 1, [pr({ state: 'CLOSED', number: 2 }), pr()]);
    expect(c.category).toBe('merged-pr');
  });

  it('content already in main, no PR → superseded', () => {
    const c = classifyBranch(branch({ upstream: null }), false, 2, [], equivalent);
    expect(c.category).toBe('superseded');
    expect(c.reason).toContain('3 touched file(s)');
  });

  it('content already in main and ahead of a merged PR → superseded, not doubt', () => {
    const c = classifyBranch(branch({ sha: 'bbb' }), false, 5, [pr({ headRefOid: 'aaa' })], equivalent);
    expect(c.category).toBe('superseded');
  });

  it('an OPEN PR outranks content equivalence — deleting would close the PR', () => {
    const c = classifyBranch(branch(), false, 2, [pr({ state: 'OPEN' })], equivalent);
    expect(c.category).toBe('doubt');
    expect(c.reason).toContain('open PR');
  });

  it('a lookup failure outranks content equivalence — an OPEN PR could be invisible', () => {
    const c = classifyBranch(branch(), false, 2, 'lookup-failed', equivalent);
    expect(c.category).toBe('doubt');
  });

  it('non-equivalent content leaves the PR-based verdict untouched', () => {
    const c = classifyBranch(branch({ upstream: null }), false, 2, [], notEquivalent);
    expect(c.category).toBe('doubt');
    expect(c.reason).toContain('no upstream');
  });

  it('tags doubts keep/review so the report can separate live work from candidates', () => {
    expect(classifyBranch(branch(), false, 1, [pr({ state: 'OPEN' })]).doubtClass).toBe('keep');
    expect(classifyBranch(branch(), false, 1, 'lookup-failed').doubtClass).toBe('keep');
    expect(classifyBranch(branch(), false, 1, [pr({ state: 'CLOSED' })]).doubtClass).toBe('review');
    expect(classifyBranch(branch({ sha: 'bbb' }), false, 1, [pr()]).doubtClass).toBe('review');
    expect(classifyBranch(branch({ upstream: null }), false, 1, []).doubtClass).toBe('review');
    expect(classifyBranch(branch({ upstreamGone: true }), false, 1, []).doubtClass).toBe('review');
    // Deletable categories carry no triage bucket.
    expect(classifyBranch(branch(), true, 0, null).doubtClass).toBeUndefined();
  });
});

describe('contentEquivalence', () => {
  /** Fake GitRunner keyed by the diff range in the args. */
  function runner(map: Record<string, { stdout?: string; exitCode?: number }>) {
    return (args: string[]) => {
      const range = args[args.length - 1];
      const entry = map[range] ?? { stdout: '', exitCode: 0 };
      return { stdout: entry.stdout ?? '', stderr: '', exitCode: entry.exitCode ?? 0 };
    };
  }

  it('is equivalent when no touched file still differs from main', () => {
    const result = contentEquivalence('feat.squashed', runner({
      'origin/main...feat.squashed': { stdout: 'a.ts\nb.ts' },
      'origin/main..feat.squashed': { stdout: 'unrelated.ts' },
    }));
    expect(result).toEqual({ equivalent: true, touchedCount: 2 });
  });

  it('is not equivalent when any touched file still differs', () => {
    const result = contentEquivalence('feat.live', runner({
      'origin/main...feat.live': { stdout: 'a.ts\nb.ts' },
      'origin/main..feat.live': { stdout: 'b.ts' },
    }));
    expect(result).toEqual({ equivalent: false, touchedCount: 2 });
  });

  it('fails closed when the branch touched nothing at all', () => {
    const result = contentEquivalence('weird', runner({ 'origin/main...weird': { stdout: '' } }));
    expect(result.equivalent).toBe(false);
  });

  it('fails closed on a git error in either diff', () => {
    expect(contentEquivalence('bad', runner({
      'origin/main...bad': { exitCode: 128 },
    })).equivalent).toBe(false);
    expect(contentEquivalence('bad', runner({
      'origin/main...bad': { stdout: 'a.ts' },
      'origin/main..bad': { exitCode: 128 },
    })).equivalent).toBe(false);
  });
});

import {
  isDirty,
  isRecentlyModified,
  parseCwdPaths,
  isActiveWorktree,
  assessWorktree,
  MTIME_THRESHOLD_MS,
  type WorktreeChecks,
} from '../lib/git-cleanup.js';

const cleanChecks: WorktreeChecks = {
  locked: false, dirty: false, recentlyModified: false,
  active: false, isCurrentSession: false, isPrimary: false, branchDeletable: true,
};

describe('isDirty', () => {
  it('is true for any porcelain output, false for empty', () => {
    expect(isDirty(' M src/foo.ts')).toBe(true);
    expect(isDirty('?? new-file')).toBe(true);
    expect(isDirty('')).toBe(false);
    expect(isDirty('  \n')).toBe(false);
  });
});

describe('isRecentlyModified', () => {
  const now = 1_000_000_000_000;
  it('is true when any mtime is within the 30-minute threshold', () => {
    expect(isRecentlyModified([now - MTIME_THRESHOLD_MS + 1000], now)).toBe(true);
    expect(isRecentlyModified([now - MTIME_THRESHOLD_MS - 1000, now - 1000], now)).toBe(true);
  });
  it('is false when all mtimes are older than the threshold', () => {
    expect(isRecentlyModified([now - MTIME_THRESHOLD_MS - 1000], now)).toBe(false);
    expect(isRecentlyModified([], now)).toBe(false);
  });
});

describe('parseCwdPaths', () => {
  it('extracts n-lines from lsof -Fn output', () => {
    const out = 'p123\nn/Users/x/repo\np456\nn/Users/x/.superset/worktrees/u/foo\n';
    expect(parseCwdPaths(out)).toEqual(['/Users/x/repo', '/Users/x/.superset/worktrees/u/foo']);
  });
  it('returns empty for empty output', () => {
    expect(parseCwdPaths('')).toEqual([]);
  });
});

describe('isActiveWorktree', () => {
  const cwds = ['/Users/x/wt-a', '/Users/x/wt-b/sub/dir'];
  it('matches exact cwd and cwd nested inside the worktree', () => {
    expect(isActiveWorktree('/Users/x/wt-a', cwds)).toBe(true);
    expect(isActiveWorktree('/Users/x/wt-b', cwds)).toBe(true);
  });
  it('does not prefix-match sibling paths', () => {
    expect(isActiveWorktree('/Users/x/wt', cwds)).toBe(false);
  });
});

describe('assessWorktree', () => {
  it('is removable only when every check passes', () => {
    expect(assessWorktree(cleanChecks).removable).toBe(true);
  });
  it.each([
    ['locked', { locked: true }, 'locked'],
    ['dirty', { dirty: true }, 'uncommitted changes'],
    ['recent', { recentlyModified: true }, 'modified within the last 30 minutes'],
    ['active', { active: true }, 'live process'],
    ['current session', { isCurrentSession: true }, 'current session'],
    ['primary', { isPrimary: true }, 'primary checkout'],
    ['branch not deletable', { branchDeletable: false }, 'branch not classified deletable'],
  ] as const)('%s worktree is protected', (_label, override, reasonFragment) => {
    const result = assessWorktree({ ...cleanChecks, ...override });
    expect(result.removable).toBe(false);
    expect(result.reason).toContain(reasonFragment);
  });
});

// =============================================================================
// renderReport
// =============================================================================

import { renderReport, classify, type CleanupPlan, type ClassifyDeps } from '../lib/git-cleanup.js';

function buildPlan(): CleanupPlan {
  return {
    planId: 'plan-render-test',
    createdAt: '2026-08-08T12:00:00.000Z',
    mainSha: 'abcdef1234567890abcdef1234567890abcdef12',
    branches: [
      {
        branch: 'feat.done',
        sha: 'aaaaaaa1111111111111111111111111111111',
        category: 'merged-ancestor',
        reason: 'tip is an ancestor of origin/main',
        worktree: null,
        lastCommitDate: '2026-07-30',
        aheadCount: 0,
      },
      {
        branch: 'feat.wip',
        sha: 'bbbbbbb2222222222222222222222222222222',
        category: 'doubt',
        reason: 'open PR #42',
        worktree: '/repo/.superset/worktrees/u/wt1',
        lastCommitDate: '2026-08-05',
        aheadCount: 4,
        doubtClass: 'keep',
      },
      {
        branch: 'ancient.experiment',
        sha: 'ccccccc3333333333333333333333333333333',
        category: 'doubt',
        reason: 'no upstream, 2 unique commit(s)',
        worktree: null,
        lastCommitDate: '2025-03-14',
        aheadCount: 2,
        doubtClass: 'review',
      },
      {
        branch: 'stale.review',
        sha: 'ddddddd4444444444444444444444444444444',
        category: 'doubt',
        reason: 'PR #374 closed without merging',
        worktree: null,
        lastCommitDate: '2026-02-20',
        aheadCount: 1,
        doubtClass: 'review',
      },
    ],
    worktrees: [
      {
        path: '/repo/.superset/worktrees/u/wt1',
        branch: 'feat.wip',
        sha: 'bbbbbbb2222222222222222222222222222222',
        family: 'superset',
        removable: false,
        reason: 'uncommitted changes present',
      },
    ],
    protected: [
      { branch: 'main', reason: 'main branch' },
    ],
  };
}

describe('renderReport', () => {
  it('includes every required section header', () => {
    const report = renderReport(buildPlan());
    expect(report).toContain('## Summary');
    expect(report).toContain('## Deletable branches');
    expect(report).toContain('### merged-ancestor');
    expect(report).toContain('## Worktree removals');
    expect(report).toContain('## Doubts');
    expect(report).toContain('## Protected');
  });

  it('renders a deletable branch row with branch, short sha, and reason', () => {
    const report = renderReport(buildPlan());
    expect(report).toContain('feat.done');
    expect(report).toContain('aaaaaaa');
    expect(report).toContain('tip is an ancestor of origin/main');
  });

  it('renders doubt reasons for both doubt branches and non-removable worktrees', () => {
    const report = renderReport(buildPlan());
    expect(report).toContain('open PR #42');
    expect(report).toContain('uncommitted changes present');
  });

  it('renders a protected row with branch and reason', () => {
    const report = renderReport(buildPlan());
    expect(report).toContain('main');
    expect(report).toContain('main branch');
  });

  it('includes createdAt and mainSha in the title', () => {
    const report = renderReport(buildPlan());
    expect(report).toContain('2026-08-08T12:00:00.000Z');
    expect(report).toContain('abcdef1');
  });

  it('splits doubts into review and keep sections', () => {
    const report = renderReport(buildPlan());
    expect(report).toContain('### Review');
    expect(report).toContain('### Keep');
    const reviewIdx = report.indexOf('### Review');
    const keepIdx = report.indexOf('### Keep');
    // The open-PR doubt belongs to keep, the dead branches to review.
    expect(report.indexOf('ancient.experiment')).toBeGreaterThan(reviewIdx);
    expect(report.indexOf('ancient.experiment')).toBeLessThan(keepIdx);
    expect(report.indexOf('feat.wip')).toBeGreaterThan(keepIdx);
  });

  it('orders review doubts oldest first and shows age and ahead count', () => {
    const report = renderReport(buildPlan());
    expect(report.indexOf('ancient.experiment')).toBeLessThan(report.indexOf('stale.review'));
    expect(report).toContain('2025-03-14');
    expect(report).toContain('| 2 |');
  });

  it('points the operator at the explicit-branch path instead of a manual delete loop', () => {
    expect(renderReport(buildPlan())).toContain('--branches=');
  });

  it('shows the last commit date on deletable rows too', () => {
    expect(renderReport(buildPlan())).toContain('2026-07-30');
  });
});

// =============================================================================
// classify
// =============================================================================

const REFS_OUTPUT = [
  'main\tmainsha1234567890abcdef1234567890abcdef12\torigin/main\t\t2026-08-07',
  'ancestor.done\taaaaaaa1111111111111111111111111111111\torigin/ancestor.done\t[gone]\t2026-07-15',
  'gone.branch\tbbbbbbb2222222222222222222222222222222\torigin/gone.branch\t[gone]\t2026-06-01',
].join('\n');

const MERGED_OUTPUT = ['main', 'ancestor.done'].join('\n');

const WORKTREE_OUTPUT = [
  'worktree /repo',
  'HEAD mainsha1234567890abcdef1234567890abcdef12',
  'branch refs/heads/main',
  '',
].join('\n');

function happyPathSpawn(
  ghResult: SpawnSyncReturns<Buffer>,
  // The step-9b content probe: three-dot diff (files the branch touched),
  // then two-dot diff (files still differing from main). Defaults describe a
  // branch that still carries work of its own.
  contentDiffs: SpawnSyncReturns<Buffer>[] = [fakeSpawn('src/live.ts'), fakeSpawn('src/live.ts')],
) {
  return seqSpawn(
    fakeSpawn('/repo/.git'),                                    // rev-parse --git-common-dir
    fakeSpawn('true'),                                          // rev-parse --is-inside-work-tree
    fakeSpawn(''),                                               // fetch --prune origin
    fakeSpawn('mainsha1234567890abcdef1234567890abcdef12'),     // rev-parse origin/main
    fakeSpawn(REFS_OUTPUT),                                      // for-each-ref refs/heads
    fakeSpawn(MERGED_OUTPUT),                                    // for-each-ref refs/heads --merged origin/main
    fakeSpawn(WORKTREE_OUTPUT),                                  // worktree list --porcelain
    fakeSpawn('3'),                                              // rev-list --count origin/main..gone.branch
    fakeSpawn('git@github.com:me/repo.git'),                     // remote get-url origin
    ghResult,                                                    // gh api graphql
    ...contentDiffs,                                             // diff --name-only (3-dot, 2-dot)
  );
}

describe('classify', () => {
  it('happy path: ancestor branch + gone-with-commits branch, writes plan/report, returns summary', () => {
    const written: Record<string, string> = {};
    const ghResult = fakeSpawn(JSON.stringify({ data: { repository: { b0: { nodes: [] } } } }));
    const deps: ClassifyDeps = {
      spawnFn: happyPathSpawn(ghResult) as unknown as ClassifyDeps['spawnFn'],
      cwd: '/repo',
      nowMs: () => 1_700_000_000_000,
      statMtimes: () => [],
      writeFile: (path, content) => { written[path] = content; },
    };

    const result = classify(deps);

    expect(result.ok).toBe(true);
    expect(result.plan?.mainSha).toBe('mainsha1234567890abcdef1234567890abcdef12');
    const branches = result.plan?.branches ?? [];
    expect(branches.find((b) => b.branch === 'main')).toBeUndefined();
    expect(branches.find((b) => b.branch === 'ancestor.done')?.category).toBe('merged-ancestor');
    const gone = branches.find((b) => b.branch === 'gone.branch');
    expect(gone?.category).toBe('doubt');
    expect(gone?.reason).toContain('upstream gone');
    expect(gone?.lastCommitDate).toBe('2026-06-01');
    expect(gone?.aheadCount).toBe(3);
    expect(result.summary).toEqual({
      'merged-ancestor': 1, 'merged-pr': 0, empty: 0, superseded: 0, doubt: 1,
    });
    expect(result.planPath).toBe('/repo/.git/git-cleanup-plan.json');
    expect(result.reportPath).toBe('/repo/.git/git-cleanup-report.md');
    expect(written['/repo/.git/git-cleanup-plan.json']).toBeDefined();
    expect(written['/repo/.git/git-cleanup-report.md']).toBeDefined();
    expect(JSON.parse(written['/repo/.git/git-cleanup-plan.json']).mainSha).toBe(
      'mainsha1234567890abcdef1234567890abcdef12',
    );
  });

  it('classifies a branch whose touched files all match main as superseded', () => {
    const ghResult = fakeSpawn(JSON.stringify({ data: { repository: { b0: { nodes: [] } } } }));
    const deps: ClassifyDeps = {
      spawnFn: happyPathSpawn(ghResult, [
        fakeSpawn('src/a.ts\nsrc/b.ts'),   // diff --name-only origin/main...gone.branch
        fakeSpawn('docs/unrelated.md'),    // diff --name-only origin/main..gone.branch
      ]) as unknown as ClassifyDeps['spawnFn'],
      cwd: '/repo',
      nowMs: () => 1_700_000_000_000,
      statMtimes: () => [],
      writeFile: () => {},
    };

    const result = classify(deps);

    const gone = result.plan?.branches.find((b) => b.branch === 'gone.branch');
    expect(gone?.category).toBe('superseded');
    expect(gone?.reason).toContain('2 touched file(s)');
    expect(result.summary?.superseded).toBe(1);
  });

  it('skips the content probe when GitHub already decided the branch (open PR)', () => {
    const calls: string[] = [];
    const ghResult = fakeSpawn(JSON.stringify({
      data: { repository: { b0: { nodes: [{ number: 7, state: 'OPEN', headRefOid: 'zzz' }] } } },
    }));
    const inner = happyPathSpawn(ghResult);
    const recording = (cmd: string, args: string[], opts: unknown) => {
      calls.push(`${cmd} ${args.join(' ')}`);
      return (inner as (c: string, a: string[], o: unknown) => SpawnSyncReturns<Buffer>)(cmd, args, opts);
    };
    const deps: ClassifyDeps = {
      spawnFn: recording as unknown as ClassifyDeps['spawnFn'],
      cwd: '/repo',
      nowMs: () => 1_700_000_000_000,
      statMtimes: () => [],
      writeFile: () => {},
    };

    const result = classify(deps);

    expect(result.plan?.branches.find((b) => b.branch === 'gone.branch')?.category).toBe('doubt');
    expect(calls.some((c) => c.includes('diff --name-only'))).toBe(false);
  });

  it('git fetch failure returns ok: false without writing files', () => {
    const written: Record<string, string> = {};
    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'),
      fakeSpawn('true'),
      fakeSpawn('', 'network unreachable', 128),
    );
    const deps: ClassifyDeps = {
      spawnFn: spawn as unknown as ClassifyDeps['spawnFn'],
      cwd: '/repo',
      writeFile: (path, content) => { written[path] = content; },
    };

    const result = classify(deps);

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(Object.keys(written)).toHaveLength(0);
  });

  it('gh failure classifies non-ancestor branches as doubt with lookup-failed reason, ok: true', () => {
    const written: Record<string, string> = {};
    const ghResult = fakeSpawn('', 'gh: authentication required', 1);
    const deps: ClassifyDeps = {
      spawnFn: happyPathSpawn(ghResult) as unknown as ClassifyDeps['spawnFn'],
      cwd: '/repo',
      nowMs: () => 1_700_000_000_000,
      statMtimes: () => [],
      writeFile: (path, content) => { written[path] = content; },
    };

    const result = classify(deps);

    expect(result.ok).toBe(true);
    const gone = result.plan?.branches.find((b) => b.branch === 'gone.branch');
    expect(gone?.category).toBe('doubt');
    expect(gone?.reason).toContain('lookup failed');
  });

  it('canonicalizes worktree and lsof cwd paths before comparing (symlinked ancestor)', () => {
    // git worktree list reports the creation-time path; lsof reports the
    // kernel-canonical path. A symlinked ancestor makes them differ as raw
    // strings — classify must resolve both through realpath before
    // isActiveWorktree compares them (Task 4 review carry-forward).
    const worktreeOutput = [
      'worktree /repo',
      'HEAD mainsha1234567890abcdef1234567890abcdef12',
      'branch refs/heads/main',
      '',
      'worktree /symlink-alias/.superset/worktrees/u/wt2',
      'HEAD cccccc3333333333333333333333333333333333',
      'branch refs/heads/wt2branch',
      '',
    ].join('\n');
    // wt2branch is an ancestor of origin/main (merged-ancestor, deletable) so
    // it clears the branch-deletable gate and the test can observe the
    // 'active' check specifically.
    const refsOutput = [
      'main\tmainsha1234567890abcdef1234567890abcdef12\torigin/main\t',
      'wt2branch\tcccccc3333333333333333333333333333333333\torigin/wt2branch\t',
    ].join('\n');

    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'),                                    // rev-parse --git-common-dir
      fakeSpawn('true'),                                          // rev-parse --is-inside-work-tree
      fakeSpawn(''),                                               // fetch --prune origin
      fakeSpawn('mainsha1234567890abcdef1234567890abcdef12'),     // rev-parse origin/main
      fakeSpawn(refsOutput),                                       // for-each-ref refs/heads
      fakeSpawn('main\nwt2branch'),                                 // for-each-ref --merged origin/main
      fakeSpawn(worktreeOutput),                                   // worktree list --porcelain
      fakeSpawn('n/real/wt2\n'),                                   // lsof -a -d cwd -Fn (called once, before the per-worktree loop)
      fakeSpawn(''),                                                // git -C /symlink-alias/.superset/worktrees/u/wt2 status --porcelain
    );

    const written: Record<string, string> = {};
    const deps: ClassifyDeps = {
      spawnFn: spawn as unknown as ClassifyDeps['spawnFn'],
      cwd: '/repo',
      nowMs: () => 1_700_000_000_000,
      statMtimes: () => [],
      writeFile: (path, content) => { written[path] = content; },
      realpath: (p) => (p === '/symlink-alias/.superset/worktrees/u/wt2' ? '/real/wt2' : p),
    };

    const result = classify(deps);

    expect(result.ok).toBe(true);
    const wt2 = result.plan?.worktrees.find((w) => w.path === '/symlink-alias/.superset/worktrees/u/wt2');
    expect(wt2?.removable).toBe(false);
    expect(wt2?.reason).toContain('live process has cwd inside worktree');
  });

  it('protects a nested current-session worktree and its branch (most-specific-wins containment)', () => {
    // Agent worktrees live INSIDE the primary checkout
    // (<repo>/.claude/worktrees/agent-1). A cwd inside the nested worktree
    // is also a prefix match for the primary — the containing-worktree
    // lookup must pick the longest (most specific) match, or the session
    // branch is never protected and the nested worktree is never flagged
    // as the current session.
    const nestedPath = '/repo/.claude/worktrees/agent-1';
    const worktreeOutput = [
      'worktree /repo',
      'HEAD mainsha1234567890abcdef1234567890abcdef12',
      'branch refs/heads/main',
      '',
      `worktree ${nestedPath}`,
      'HEAD dddddd4444444444444444444444444444444444',
      'branch refs/heads/agent.branch',
      '',
    ].join('\n');
    const refsOutput = [
      'main\tmainsha1234567890abcdef1234567890abcdef12\torigin/main\t',
      'agent.branch\tdddddd4444444444444444444444444444444444\torigin/agent.branch\t',
    ].join('\n');

    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'),                                    // rev-parse --git-common-dir
      fakeSpawn('true'),                                          // rev-parse --is-inside-work-tree
      fakeSpawn(''),                                               // fetch --prune origin
      fakeSpawn('mainsha1234567890abcdef1234567890abcdef12'),     // rev-parse origin/main
      fakeSpawn(refsOutput),                                       // for-each-ref refs/heads
      fakeSpawn('main'),                                           // for-each-ref --merged origin/main (agent.branch NOT merged)
      fakeSpawn(worktreeOutput),                                   // worktree list --porcelain
      fakeSpawn(''),                                                // lsof -a -d cwd -Fn (no live processes)
      fakeSpawn(''),                                                // git -C <nested> status --porcelain (clean)
    );

    const deps: ClassifyDeps = {
      spawnFn: spawn as unknown as ClassifyDeps['spawnFn'],
      cwd: `${nestedPath}/src`, // session cwd nested inside the agent worktree
      nowMs: () => 1_700_000_000_000,
      statMtimes: () => [],
      writeFile: () => {},
      realpath: (p) => p,
    };

    const result = classify(deps);

    expect(result.ok).toBe(true);
    // agent.branch is not an ancestor and would otherwise need a PR lookup
    // to classify — it never reaches classifyBranch because it's protected.
    expect(result.plan?.branches.find((b) => b.branch === 'agent.branch')).toBeUndefined();
    const protectedEntry = result.plan?.protected.find((p) => p.branch === 'agent.branch');
    expect(protectedEntry).toBeDefined();
    expect(protectedEntry?.reason).toContain('current session');
    const nestedWt = result.plan?.worktrees.find((w) => w.path === nestedPath);
    expect(nestedWt?.removable).toBe(false);
    expect(nestedWt?.reason).toContain('current session');
  });

  it('a clean, inactive worktree whose branch is a doubt is not removable', () => {
    // Path deliberately lives under a managed family (superset) so the
    // 'other'-family override (see the dedicated other-family test below)
    // doesn't mask the "branch not classified deletable" reason this test
    // is checking.
    const wtPath = '/repo/.superset/worktrees/u2/feat-open-wt';
    const worktreeOutput = [
      'worktree /repo',
      'HEAD mainsha1234567890abcdef1234567890abcdef12',
      'branch refs/heads/main',
      '',
      `worktree ${wtPath}`,
      'HEAD eeeeee5555555555555555555555555555555555',
      'branch refs/heads/feat.open',
      '',
    ].join('\n');
    const refsOutput = [
      'main\tmainsha1234567890abcdef1234567890abcdef12\torigin/main\t',
      'feat.open\teeeeee5555555555555555555555555555555555\torigin/feat.open\t',
    ].join('\n');
    const ghResult = fakeSpawn(JSON.stringify({
      data: { repository: { b0: { nodes: [{ number: 9, state: 'OPEN', headRefOid: 'eeeeee5555555555555555555555555555555555' }] } } },
    }));

    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'),                                    // rev-parse --git-common-dir
      fakeSpawn('true'),                                          // rev-parse --is-inside-work-tree
      fakeSpawn(''),                                               // fetch --prune origin
      fakeSpawn('mainsha1234567890abcdef1234567890abcdef12'),     // rev-parse origin/main
      fakeSpawn(refsOutput),                                       // for-each-ref refs/heads
      fakeSpawn('main'),                                           // for-each-ref --merged origin/main
      fakeSpawn(worktreeOutput),                                   // worktree list --porcelain
      fakeSpawn('2'),                                               // rev-list --count origin/main..feat.open
      fakeSpawn('git@github.com:me/repo.git'),                     // remote get-url origin
      ghResult,                                                    // gh api graphql
      fakeSpawn(''),                                                // lsof -a -d cwd -Fn (no live processes)
      fakeSpawn(''),                                                // git -C <wtPath> status --porcelain (clean)
    );

    const deps: ClassifyDeps = {
      spawnFn: spawn as unknown as ClassifyDeps['spawnFn'],
      cwd: '/repo',
      nowMs: () => 1_700_000_000_000,
      statMtimes: () => [],
      writeFile: () => {},
    };

    const result = classify(deps);

    expect(result.ok).toBe(true);
    expect(result.plan?.branches.find((b) => b.branch === 'feat.open')?.category).toBe('doubt');
    const wt = result.plan?.worktrees.find((w) => w.path === wtPath);
    expect(wt?.removable).toBe(false);
    expect(wt?.reason).toBe('branch not classified deletable');
  });

  it('parses lsof stdout even on non-zero exit, and passes cwd to the lsof spawn call', () => {
    const wtPath = '/repo/.superset/worktrees/u/wt3';
    const worktreeOutput = [
      'worktree /repo',
      'HEAD mainsha1234567890abcdef1234567890abcdef12',
      'branch refs/heads/main',
      '',
      `worktree ${wtPath}`,
      'HEAD ffffff6666666666666666666666666666666666',
      'branch refs/heads/wt3branch',
      '',
    ].join('\n');
    const refsOutput = [
      'main\tmainsha1234567890abcdef1234567890abcdef12\torigin/main\t',
      'wt3branch\tffffff6666666666666666666666666666666666\torigin/wt3branch\t',
    ].join('\n');

    const baseSpawn = seqSpawn(
      fakeSpawn('/repo/.git'),                                    // rev-parse --git-common-dir
      fakeSpawn('true'),                                          // rev-parse --is-inside-work-tree
      fakeSpawn(''),                                               // fetch --prune origin
      fakeSpawn('mainsha1234567890abcdef1234567890abcdef12'),     // rev-parse origin/main
      fakeSpawn(refsOutput),                                       // for-each-ref refs/heads
      fakeSpawn('main\nwt3branch'),                                 // for-each-ref --merged origin/main
      fakeSpawn(worktreeOutput),                                   // worktree list --porcelain
      // lsof exits non-zero (macOS permission-denied on some fds) but still
      // printed a real cwd line on stdout — it must be parsed, not discarded.
      fakeSpawn('n/repo/.superset/worktrees/u/wt3\n', 'lsof: WARNING: ...', 1),
      fakeSpawn(''),                                                // git -C <wtPath> status --porcelain (clean)
    );
    const calls: Array<{ cmd: string; opts: unknown }> = [];
    const spawn = (cmd: string, args: string[], opts: unknown) => {
      calls.push({ cmd, opts });
      return baseSpawn(cmd, args, opts);
    };

    const deps: ClassifyDeps = {
      spawnFn: spawn as unknown as ClassifyDeps['spawnFn'],
      cwd: '/repo',
      nowMs: () => 1_700_000_000_000,
      statMtimes: () => [],
      writeFile: () => {},
    };

    const result = classify(deps);

    expect(result.ok).toBe(true);
    const wt3 = result.plan?.worktrees.find((w) => w.path === wtPath);
    expect(wt3?.removable).toBe(false);
    expect(wt3?.reason).toContain('live process has cwd inside worktree');

    const lsofCall = calls.find((c) => c.cmd === 'lsof');
    expect(lsofCall).toBeDefined();
    expect((lsofCall?.opts as { cwd?: string })?.cwd).toBe('/repo');
  });

  it('writes the injected planId into the plan (default is crypto.randomUUID)', () => {
    const written: Record<string, string> = {};
    const ghResult = fakeSpawn(JSON.stringify({ data: { repository: { b0: { nodes: [] } } } }));
    const deps: ClassifyDeps = {
      spawnFn: happyPathSpawn(ghResult) as unknown as ClassifyDeps['spawnFn'],
      cwd: '/repo',
      nowMs: () => 1_700_000_000_000,
      statMtimes: () => [],
      writeFile: (path, content) => { written[path] = content; },
      planId: () => 'fixed-plan-id',
    };

    const result = classify(deps);

    expect(result.ok).toBe(true);
    expect(result.plan?.planId).toBe('fixed-plan-id');
    expect(JSON.parse(written['/repo/.git/git-cleanup-plan.json']).planId).toBe('fixed-plan-id');
  });

  it('checks worktree status with --no-optional-locks (plain `git status` would rewrite the index mtime the 30-minute guard reads)', () => {
    const wtPath = '/repo/other/wt-lock';
    const worktreeOutput = [
      'worktree /repo',
      'HEAD mainsha1234567890abcdef1234567890abcdef12',
      'branch refs/heads/main',
      '',
      `worktree ${wtPath}`,
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/wt-lock-branch',
      '',
    ].join('\n');
    const refsOutput = [
      'main\tmainsha1234567890abcdef1234567890abcdef12\torigin/main\t',
      'wt-lock-branch\t1111111111111111111111111111111111111111\torigin/wt-lock-branch\t',
    ].join('\n');

    const baseSpawn = seqSpawn(
      fakeSpawn('/repo/.git'),
      fakeSpawn('true'),
      fakeSpawn(''),
      fakeSpawn('mainsha1234567890abcdef1234567890abcdef12'),
      fakeSpawn(refsOutput),
      fakeSpawn('main\nwt-lock-branch'),
      fakeSpawn(worktreeOutput),
      fakeSpawn(''), // lsof (no live procs)
      fakeSpawn(''), // git status --porcelain (clean)
    );
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const spawn = (cmd: string, args: string[], opts: unknown) => {
      calls.push({ cmd, args });
      return baseSpawn(cmd, args, opts);
    };

    const deps: ClassifyDeps = {
      spawnFn: spawn as unknown as ClassifyDeps['spawnFn'],
      cwd: '/repo',
      nowMs: () => 1_700_000_000_000,
      statMtimes: () => [],
      writeFile: () => {},
    };

    const result = classify(deps);

    expect(result.ok).toBe(true);
    const statusCall = calls.find((c) => c.cmd === 'git' && c.args.includes('status'));
    expect(statusCall?.args).toEqual(['--no-optional-locks', '-C', wtPath, 'status', '--porcelain']);
  });

  it('treats a non-zero status exit code as dirty — fails closed, not open', () => {
    const wtPath = '/repo/.superset/worktrees/u/wt-status-fail';
    const worktreeOutput = [
      'worktree /repo',
      'HEAD mainsha1234567890abcdef1234567890abcdef12',
      'branch refs/heads/main',
      '',
      `worktree ${wtPath}`,
      'HEAD 4444444444444444444444444444444444444444',
      'branch refs/heads/wt-status-fail-branch',
      '',
    ].join('\n');
    const refsOutput = [
      'main\tmainsha1234567890abcdef1234567890abcdef12\torigin/main\t',
      'wt-status-fail-branch\t4444444444444444444444444444444444444444\torigin/wt-status-fail-branch\t',
    ].join('\n');

    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'),
      fakeSpawn('true'),
      fakeSpawn(''),
      fakeSpawn('mainsha1234567890abcdef1234567890abcdef12'),
      fakeSpawn(refsOutput),
      fakeSpawn('main\nwt-status-fail-branch'),
      fakeSpawn(worktreeOutput),
      fakeSpawn(''), // lsof (no live procs)
      // git status --porcelain exits non-zero with empty stdout — must not
      // be read as "clean" just because there's no porcelain output.
      fakeSpawn('', 'fatal: unable to read index', 1),
    );

    const deps: ClassifyDeps = {
      spawnFn: spawn as unknown as ClassifyDeps['spawnFn'],
      cwd: '/repo',
      nowMs: () => 1_700_000_000_000,
      statMtimes: () => [],
      writeFile: () => {},
    };

    const result = classify(deps);

    expect(result.ok).toBe(true);
    const wt = result.plan?.worktrees.find((w) => w.path === wtPath);
    expect(wt?.removable).toBe(false);
    expect(wt?.reason).toBe('uncommitted changes present');
  });

  it('downgrades a deletable branch to doubt when its worktree is dirty (spec: dirty worktree is a branch doubt reason)', () => {
    const wtPath = '/repo/.superset/worktrees/u9/wt-dirty';
    const worktreeOutput = [
      'worktree /repo',
      'HEAD mainsha1234567890abcdef1234567890abcdef12',
      'branch refs/heads/main',
      '',
      `worktree ${wtPath}`,
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/wt-dirty-branch',
      '',
    ].join('\n');
    const refsOutput = [
      'main\tmainsha1234567890abcdef1234567890abcdef12\torigin/main\t',
      'wt-dirty-branch\t2222222222222222222222222222222222222222\torigin/wt-dirty-branch\t',
    ].join('\n');

    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'),
      fakeSpawn('true'),
      fakeSpawn(''),
      fakeSpawn('mainsha1234567890abcdef1234567890abcdef12'),
      fakeSpawn(refsOutput),
      fakeSpawn('main\nwt-dirty-branch'), // both ancestors → merged-ancestor, no PR lookup needed
      fakeSpawn(worktreeOutput),
      fakeSpawn(''),               // lsof (no live procs)
      fakeSpawn(' M dirty-file.ts'), // git status --porcelain (dirty!)
    );

    const deps: ClassifyDeps = {
      spawnFn: spawn as unknown as ClassifyDeps['spawnFn'],
      cwd: '/repo',
      nowMs: () => 1_700_000_000_000,
      statMtimes: () => [],
      writeFile: () => {},
    };

    const result = classify(deps);

    expect(result.ok).toBe(true);
    const branchItem = result.plan?.branches.find((b) => b.branch === 'wt-dirty-branch');
    expect(branchItem?.category).toBe('doubt');
    expect(branchItem?.reason).toBe('worktree: uncommitted changes present');
    const wtItem = result.plan?.worktrees.find((w) => w.path === wtPath);
    expect(wtItem?.removable).toBe(false);
    expect(wtItem?.reason).toBe('uncommitted changes present');
  });

  it('marks an other-family worktree non-removable and downgrades its branch (unmanaged family — execute can never approve it)', () => {
    const wtPath = '/elsewhere/wt-other';
    const worktreeOutput = [
      'worktree /repo',
      'HEAD mainsha1234567890abcdef1234567890abcdef12',
      'branch refs/heads/main',
      '',
      `worktree ${wtPath}`,
      'HEAD 3333333333333333333333333333333333333333',
      'branch refs/heads/wt-other-branch',
      '',
    ].join('\n');
    const refsOutput = [
      'main\tmainsha1234567890abcdef1234567890abcdef12\torigin/main\t',
      'wt-other-branch\t3333333333333333333333333333333333333333\torigin/wt-other-branch\t',
    ].join('\n');

    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'),
      fakeSpawn('true'),
      fakeSpawn(''),
      fakeSpawn('mainsha1234567890abcdef1234567890abcdef12'),
      fakeSpawn(refsOutput),
      fakeSpawn('main\nwt-other-branch'),
      fakeSpawn(worktreeOutput),
      fakeSpawn(''), // lsof (no live procs)
      fakeSpawn(''), // git status --porcelain (clean — irrelevant, the family override wins regardless)
    );

    const deps: ClassifyDeps = {
      spawnFn: spawn as unknown as ClassifyDeps['spawnFn'],
      cwd: '/repo',
      nowMs: () => 1_700_000_000_000,
      statMtimes: () => [],
      writeFile: () => {},
    };

    const result = classify(deps);

    expect(result.ok).toBe(true);
    const wtItem = result.plan?.worktrees.find((w) => w.path === wtPath);
    expect(wtItem?.family).toBe('other');
    expect(wtItem?.removable).toBe(false);
    expect(wtItem?.reason).toBe('worktree family not managed');
    const branchItem = result.plan?.branches.find((b) => b.branch === 'wt-other-branch');
    expect(branchItem?.category).toBe('doubt');
    expect(branchItem?.reason).toBe('worktree: worktree family not managed');
  });
});

// =============================================================================
// execute
// =============================================================================

import {
  isPlanStale,
  parseExecuteArgs,
  execute,
  PLAN_MAX_AGE_MS,
  type ExecuteDeps,
  type ExecuteOptions,
} from '../lib/git-cleanup.js';

describe('isPlanStale', () => {
  const now = 1_700_000_000_000;
  it('is false at 59 minutes old (fresh)', () => {
    const createdAt = new Date(now - 59 * 60_000).toISOString();
    expect(isPlanStale(createdAt, now)).toBe(false);
  });
  it('is true at 61 minutes old (stale)', () => {
    const createdAt = new Date(now - 61 * 60_000).toISOString();
    expect(isPlanStale(createdAt, now)).toBe(true);
  });
  it('PLAN_MAX_AGE_MS is exactly 60 minutes', () => {
    expect(PLAN_MAX_AGE_MS).toBe(60 * 60_000);
  });
});

describe('parseExecuteArgs', () => {
  it('parses valid categories, worktree-families, and plan-id', () => {
    const result = parseExecuteArgs([
      '--categories=merged-ancestor,empty',
      '--worktree-families=superset,agent',
      '--plan-id=abc-123',
    ]);
    expect(result).toEqual({
      categories: ['merged-ancestor', 'empty'],
      branches: [],
      worktreeFamilies: ['superset', 'agent'],
      planId: 'abc-123',
    });
  });

  it('accepts superseded as a category', () => {
    const result = parseExecuteArgs(['--categories=superseded', '--plan-id=abc-123']);
    expect('error' in result).toBe(false);
  });

  it('accepts --branches with no categories at all', () => {
    const result = parseExecuteArgs(['--branches=old-a,old-b', '--plan-id=abc-123']);
    expect(result).toEqual({
      categories: [],
      branches: ['old-a', 'old-b'],
      worktreeFamilies: [],
      planId: 'abc-123',
    });
  });

  it('still rejects doubt as a category, and says what to use instead', () => {
    const result = parseExecuteArgs(['--categories=doubt', '--plan-id=abc-123']);
    expect('error' in result && result.error).toContain('--branches');
  });

  it('rejects an unknown category', () => {
    const result = parseExecuteArgs(['--categories=merged-ancestor,bogus', '--plan-id=abc-123']);
    expect('error' in result && result.error).toBeTruthy();
  });

  it('rejects doubt explicitly', () => {
    const result = parseExecuteArgs(['--categories=doubt', '--plan-id=abc-123']);
    expect('error' in result && result.error).toContain('doubt');
  });

  it('defaults worktree-families to empty when the flag is missing', () => {
    const result = parseExecuteArgs(['--categories=empty', '--plan-id=abc-123']);
    expect(result).toEqual({
      categories: ['empty'], branches: [], worktreeFamilies: [], planId: 'abc-123',
    });
  });

  it('errors when neither categories nor branches is given', () => {
    const result = parseExecuteArgs(['--plan-id=abc-123']);
    expect('error' in result && result.error).toContain('--branches');
  });

  it('rejects a missing plan-id', () => {
    const result = parseExecuteArgs(['--categories=empty']);
    expect('error' in result && result.error).toContain('plan-id');
  });
});

// -----------------------------------------------------------------------------
// execute() test helpers
// -----------------------------------------------------------------------------

const TEST_PLAN_ID = 'plan-test-id';

function execPlan(over: Partial<CleanupPlan> = {}): CleanupPlan {
  return {
    planId: TEST_PLAN_ID,
    createdAt: new Date(1_700_000_000_000 - 5 * 60_000).toISOString(),
    mainSha: 'mainsha1234567890abcdef1234567890abcdef12',
    branches: [],
    worktrees: [],
    protected: [],
    ...over,
  };
}

/** Records appendFile calls (with a shared sequence counter against spawn calls). */
function makeExecDeps(plan: CleanupPlan, spawn: ReturnType<typeof seqSpawn>) {
  const calls: string[] = [];
  const wrappedSpawn = (cmd: string, args: string[], opts: unknown) => {
    calls.push(`spawn:${cmd} ${args.join(' ')}`);
    return spawn(cmd, args, opts);
  };
  const appended: string[] = [];
  const deps: ExecuteDeps = {
    spawnFn: wrappedSpawn as unknown as ExecuteDeps['spawnFn'],
    cwd: '/repo',
    nowMs: () => 1_700_000_000_000,
    statMtimes: () => [],
    readFile: () => JSON.stringify(plan),
    appendFile: (_path, line) => {
      calls.push(`append:${line.trim()}`);
      appended.push(line);
    },
  };
  return { deps, calls, appended };
}

describe('execute', () => {
  it('missing plan file returns ok: false', () => {
    const spawn = seqSpawn(fakeSpawn('/repo/.git')); // rev-parse --git-common-dir
    const deps: ExecuteDeps = {
      spawnFn: spawn as unknown as ExecuteDeps['spawnFn'],
      cwd: '/repo',
      readFile: () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
    };
    const opts: ExecuteOptions = { branches: [], categories: ['merged-ancestor'], worktreeFamilies: [], planId: TEST_PLAN_ID };

    const result = execute(opts, deps);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('no plan file');
    expect(result.deletedBranches).toEqual([]);
    expect(result.undoLogPath).toBeNull();
  });

  it('stale plan (>60min old) returns ok: false', () => {
    const plan = execPlan({ createdAt: new Date(1_700_000_000_000 - 61 * 60_000).toISOString() });
    const spawn = seqSpawn(fakeSpawn('/repo/.git')); // rev-parse --git-common-dir
    const deps: ExecuteDeps = {
      spawnFn: spawn as unknown as ExecuteDeps['spawnFn'],
      cwd: '/repo',
      nowMs: () => 1_700_000_000_000,
      readFile: () => JSON.stringify(plan),
    };
    const opts: ExecuteOptions = { branches: [], categories: ['merged-ancestor'], worktreeFamilies: [], planId: TEST_PLAN_ID };

    const result = execute(opts, deps);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('60 minutes');
  });

  it('refuses to execute when --plan-id does not match the saved plan', () => {
    const plan = execPlan({ planId: 'plan-abc' });
    const spawn = seqSpawn(fakeSpawn('/repo/.git')); // rev-parse --git-common-dir
    const deps: ExecuteDeps = {
      spawnFn: spawn as unknown as ExecuteDeps['spawnFn'],
      cwd: '/repo',
      nowMs: () => 1_700_000_000_000,
      readFile: () => JSON.stringify(plan),
    };
    const opts: ExecuteOptions = { branches: [], categories: ['merged-ancestor'], worktreeFamilies: [], planId: 'plan-xyz' };

    const result = execute(opts, deps);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('plan id mismatch');
    expect(result.deletedBranches).toEqual([]);
  });

  it('corrupt plan JSON returns ok: false instead of throwing', () => {
    const spawn = seqSpawn(fakeSpawn('/repo/.git')); // rev-parse --git-common-dir
    const deps: ExecuteDeps = {
      spawnFn: spawn as unknown as ExecuteDeps['spawnFn'],
      cwd: '/repo',
      nowMs: () => 1_700_000_000_000,
      readFile: () => '{not valid json',
    };
    const opts: ExecuteOptions = { branches: [], categories: ['merged-ancestor'], worktreeFamilies: [], planId: TEST_PLAN_ID };

    const result = execute(opts, deps);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('not valid JSON');
  });

  it('returns ok: false when the live worktree-list re-read fails, without deleting anything', () => {
    const plan = execPlan({
      branches: [
        {
          branch: 'b8', sha: 'sha8', category: 'merged-ancestor',
          reason: 'tip is an ancestor of origin/main', worktree: '/repo/wt8',
          lastCommitDate: '2026-01-01', aheadCount: 1,
        },
      ],
      worktrees: [
        {
          path: '/repo/wt8', branch: 'b8', sha: 'sha8', family: 'superset',
          removable: true, reason: 'clean, inactive, unlocked',
        },
      ],
    });
    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'),                              // rev-parse --git-common-dir
      fakeSpawn(''),                                          // lsof -a -d cwd -Fn
      fakeSpawn('', 'fatal: not a git repository', 128),      // git worktree list --porcelain (fails)
    );
    const { deps } = makeExecDeps(plan, spawn);
    const opts: ExecuteOptions = {
      branches: [], categories: ['merged-ancestor'], worktreeFamilies: ['superset'], planId: TEST_PLAN_ID,
    };

    const result = execute(opts, deps);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('worktree list');
    expect(result.deletedBranches).toEqual([]);
    expect(result.removedWorktrees).toEqual([]);
  });

  it('happy path: deletes a plain branch and a worktree branch (-D), undo line appended before delete', () => {
    const plan = execPlan({
      branches: [
        {
          branch: 'b1', sha: 'sha1', category: 'merged-ancestor',
          reason: 'tip is an ancestor of origin/main', worktree: null,
          lastCommitDate: '2026-01-01', aheadCount: 1,
        },
        {
          branch: 'b2', sha: 'sha2', category: 'merged-pr',
          reason: 'PR #1 merged at branch tip', worktree: '/repo/wt2',
          lastCommitDate: '2026-01-01', aheadCount: 1,
        },
      ],
      worktrees: [
        {
          path: '/repo/wt2', branch: 'b2', sha: 'sha2', family: 'superset',
          removable: true, reason: 'clean, inactive, unlocked',
        },
      ],
    });
    const liveWorktreeOutput = [
      'worktree /repo',
      'HEAD mainsha1234567890abcdef1234567890abcdef12',
      'branch refs/heads/main',
      '',
      'worktree /repo/wt2',
      'HEAD sha2',
      'branch refs/heads/b2',
      '',
    ].join('\n');
    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'),               // rev-parse --git-common-dir
      fakeSpawn(''),                          // lsof -a -d cwd -Fn
      fakeSpawn(liveWorktreeOutput),           // git worktree list --porcelain (live session check; cwd=/repo, not inside wt2)
      fakeSpawn(''),                          // git -C /repo/wt2 status --porcelain (clean)
      fakeSpawn(''),                          // git worktree remove /repo/wt2
      fakeSpawn('sha1'),                      // git rev-parse refs/heads/b1
      fakeSpawn(''),                          // git merge-base --is-ancestor sha1 origin/main
      fakeSpawn(''),                          // git branch -D b1
      fakeSpawn('sha2'),                      // git rev-parse refs/heads/b2
      fakeSpawn(''),                          // git branch -D b2 (merged-pr: no ancestry re-verify)
      fakeSpawn(''),                          // git worktree prune
    );
    const { deps, calls } = makeExecDeps(plan, spawn);
    const opts: ExecuteOptions = {
      branches: [], categories: ['merged-ancestor', 'merged-pr'], worktreeFamilies: ['superset'], planId: TEST_PLAN_ID,
    };

    const result = execute(opts, deps);

    expect(result.ok).toBe(true);
    expect(result.deletedBranches).toEqual(['b1', 'b2']);
    expect(result.removedWorktrees).toEqual(['/repo/wt2']);
    expect(result.skipped).toEqual([]);
    expect(result.undoLogPath).toBe('/repo/.git/git-cleanup-undo-2023-11-14.log');

    // -D for both; merged-ancestor earns it by a live ancestry re-verify
    expect(calls).toContain('spawn:git merge-base --is-ancestor sha1 origin/main');
    const b1DeleteIdx = calls.indexOf('spawn:git branch -D b1');
    const b2DeleteIdx = calls.indexOf('spawn:git branch -D b2');
    expect(b1DeleteIdx).toBeGreaterThan(-1);
    expect(b2DeleteIdx).toBeGreaterThan(-1);

    // undo line appended strictly BEFORE its branch's delete call
    const b1AppendIdx = calls.indexOf('append:b1 sha1');
    const b2AppendIdx = calls.indexOf('append:b2 sha2');
    expect(b1AppendIdx).toBeGreaterThan(-1);
    expect(b2AppendIdx).toBeGreaterThan(-1);
    expect(b1AppendIdx).toBeLessThan(b1DeleteIdx);
    expect(b2AppendIdx).toBeLessThan(b2DeleteIdx);

    // worktree removed before its branch is deleted
    const wtRemoveIdx = calls.indexOf('spawn:git worktree remove /repo/wt2');
    expect(wtRemoveIdx).toBeGreaterThan(-1);
    expect(wtRemoveIdx).toBeLessThan(b2DeleteIdx);
  });

  it('re-verify skip when rev-parse shows the branch moved since classify', () => {
    const plan = execPlan({
      branches: [
        {
          branch: 'b5', sha: 'sha5', category: 'merged-ancestor',
          reason: 'tip is an ancestor of origin/main', worktree: null,
          lastCommitDate: '2026-01-01', aheadCount: 1,
        },
      ],
    });
    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'),          // rev-parse --git-common-dir
      fakeSpawn('sha5-moved'),          // git rev-parse refs/heads/b5 (moved)
      fakeSpawn(''),                     // git worktree prune
    );
    const { deps, appended } = makeExecDeps(plan, spawn);
    const opts: ExecuteOptions = { branches: [], categories: ['merged-ancestor'], worktreeFamilies: [], planId: TEST_PLAN_ID };

    const result = execute(opts, deps);

    expect(result.ok).toBe(true);
    expect(result.deletedBranches).toEqual([]);
    expect(result.skipped).toEqual([{ item: 'b5', reason: 'branch moved since classify' }]);
    expect(appended).toEqual([]); // never append undo line for a skipped branch
  });

  it('worktree family not approved skips both the worktree and its branch', () => {
    const plan = execPlan({
      branches: [
        {
          branch: 'b3', sha: 'sha3', category: 'empty',
          reason: 'no upstream, no commits beyond main', worktree: '/repo/wt3',
          lastCommitDate: '2026-01-01', aheadCount: 1,
        },
      ],
      worktrees: [
        {
          path: '/repo/wt3', branch: 'b3', sha: 'sha3', family: 'agent',
          removable: true, reason: 'clean, inactive, unlocked',
        },
      ],
    });
    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'), // rev-parse --git-common-dir
      fakeSpawn(''),            // git worktree prune
    );
    const { deps } = makeExecDeps(plan, spawn);
    // 'agent' family not in the approved list — only 'superset' is approved.
    const opts: ExecuteOptions = { branches: [], categories: ['empty'], worktreeFamilies: ['superset'], planId: TEST_PLAN_ID };

    const result = execute(opts, deps);

    expect(result.ok).toBe(true);
    expect(result.deletedBranches).toEqual([]);
    expect(result.removedWorktrees).toEqual([]);
    expect(result.skipped).toEqual(expect.arrayContaining([
      { item: '/repo/wt3', reason: 'worktree family not approved' },
      { item: 'b3', reason: 'worktree family not approved' },
    ]));
  });

  it('dirty-on-reverify worktree is skipped via assessWorktree reason, branch never attempted', () => {
    const plan = execPlan({
      branches: [
        {
          branch: 'b4', sha: 'sha4', category: 'empty',
          reason: 'no upstream, no commits beyond main', worktree: '/repo/wt4',
          lastCommitDate: '2026-01-01', aheadCount: 1,
        },
      ],
      worktrees: [
        {
          path: '/repo/wt4', branch: 'b4', sha: 'sha4', family: 'superset',
          removable: true, reason: 'clean, inactive, unlocked',
        },
      ],
    });
    const liveWorktreeOutput = [
      'worktree /repo',
      'HEAD mainsha1234567890abcdef1234567890abcdef12',
      'branch refs/heads/main',
      '',
      'worktree /repo/wt4',
      'HEAD sha4',
      'branch refs/heads/b4',
      '',
    ].join('\n');
    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'),        // rev-parse --git-common-dir
      fakeSpawn(''),                   // lsof -a -d cwd -Fn
      fakeSpawn(liveWorktreeOutput),    // git worktree list --porcelain (live session check; cwd=/repo, not inside wt4)
      fakeSpawn(' M dirty-file.ts'),   // git -C /repo/wt4 status --porcelain (dirty!)
      fakeSpawn(''),                   // git worktree prune
    );
    const { deps, appended } = makeExecDeps(plan, spawn);
    const opts: ExecuteOptions = { branches: [], categories: ['empty'], worktreeFamilies: ['superset'], planId: TEST_PLAN_ID };

    const result = execute(opts, deps);

    expect(result.ok).toBe(true);
    expect(result.removedWorktrees).toEqual([]);
    expect(result.deletedBranches).toEqual([]);
    expect(result.skipped).toEqual(expect.arrayContaining([
      { item: '/repo/wt4', reason: 'uncommitted changes present' },
      { item: 'b4', reason: 'uncommitted changes present' },
    ]));
    expect(appended).toEqual([]);
  });

  it('cwd inside a candidate worktree is skipped with the current-session reason, not removed (live derivation)', () => {
    // Regression: execute() must not assume isCurrentSession is false. If
    // the user cd's into a candidate worktree between plan approval and
    // execute running, lsof alone won't catch it (fails open when
    // absent/permission-limited, and a shell sitting idle at a prompt has
    // no listed fd at all) — execute must re-derive the session worktree
    // live, via the same findContainingWorktree longest-match containment
    // classify() uses.
    const plan = execPlan({
      branches: [
        {
          branch: 'b6', sha: 'sha6', category: 'merged-ancestor',
          reason: 'tip is an ancestor of origin/main', worktree: '/repo/wt6',
          lastCommitDate: '2026-01-01', aheadCount: 1,
        },
      ],
      worktrees: [
        {
          path: '/repo/wt6', branch: 'b6', sha: 'sha6', family: 'superset',
          removable: true, reason: 'clean, inactive, unlocked',
        },
      ],
    });
    const liveWorktreeOutput = [
      'worktree /repo',
      'HEAD mainsha1234567890abcdef1234567890abcdef12',
      'branch refs/heads/main',
      '',
      'worktree /repo/wt6',
      'HEAD sha6',
      'branch refs/heads/b6',
      '',
    ].join('\n');
    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'),        // rev-parse --git-common-dir
      fakeSpawn(''),                   // lsof -a -d cwd -Fn (no active procs — lsof alone would miss this)
      fakeSpawn(liveWorktreeOutput),    // git worktree list --porcelain (live: cwd is nested inside wt6)
      fakeSpawn(''),                    // git -C /repo/wt6 status --porcelain (clean)
      fakeSpawn(''),                    // git worktree prune
    );
    const { deps } = makeExecDeps(plan, spawn);
    deps.cwd = '/repo/wt6/src'; // simulates cd'ing into the candidate worktree after approval
    const opts: ExecuteOptions = {
      branches: [], categories: ['merged-ancestor'], worktreeFamilies: ['superset'], planId: TEST_PLAN_ID,
    };

    const result = execute(opts, deps);

    expect(result.ok).toBe(true);
    expect(result.removedWorktrees).toEqual([]);
    expect(result.deletedBranches).toEqual([]);
    expect(result.skipped).toEqual(expect.arrayContaining([
      { item: '/repo/wt6', reason: 'current session worktree — never removed' },
      { item: 'b6', reason: 'current session worktree — never removed' },
    ]));
  });

  it('passes shell:false on every destructive git spawn (worktree remove, branch delete)', () => {
    const plan = execPlan({
      branches: [
        {
          branch: 'b7', sha: 'sha7', category: 'merged-ancestor',
          reason: 'tip is an ancestor of origin/main', worktree: '/repo/wt7',
          lastCommitDate: '2026-01-01', aheadCount: 1,
        },
      ],
      worktrees: [
        {
          path: '/repo/wt7', branch: 'b7', sha: 'sha7', family: 'superset',
          removable: true, reason: 'clean, inactive, unlocked',
        },
      ],
    });
    const liveWorktreeOutput = [
      'worktree /repo',
      'HEAD mainsha1234567890abcdef1234567890abcdef12',
      'branch refs/heads/main',
      '',
      'worktree /repo/wt7',
      'HEAD sha7',
      'branch refs/heads/b7',
      '',
    ].join('\n');
    const baseSpawn = seqSpawn(
      fakeSpawn('/repo/.git'),        // rev-parse --git-common-dir
      fakeSpawn(''),                   // lsof -a -d cwd -Fn
      fakeSpawn(liveWorktreeOutput),    // git worktree list --porcelain
      fakeSpawn(''),                    // git -C /repo/wt7 status --porcelain (clean)
      fakeSpawn(''),                    // git worktree remove /repo/wt7
      fakeSpawn('sha7'),                // git rev-parse refs/heads/b7
      fakeSpawn(''),                    // git merge-base --is-ancestor sha7 origin/main
      fakeSpawn(''),                    // git branch -D b7
      fakeSpawn(''),                    // git worktree prune
    );
    const recorded: Array<{ cmd: string; args: string[]; opts: unknown }> = [];
    const spawn = (cmd: string, args: string[], opts: unknown) => {
      recorded.push({ cmd, args, opts });
      return baseSpawn(cmd, args, opts);
    };
    const deps: ExecuteDeps = {
      spawnFn: spawn as unknown as ExecuteDeps['spawnFn'],
      cwd: '/repo',
      nowMs: () => 1_700_000_000_000,
      statMtimes: () => [],
      readFile: () => JSON.stringify(plan),
      appendFile: () => {},
    };
    const opts: ExecuteOptions = {
      branches: [], categories: ['merged-ancestor'], worktreeFamilies: ['superset'], planId: TEST_PLAN_ID,
    };

    const result = execute(opts, deps);

    expect(result.ok).toBe(true);
    expect(result.deletedBranches).toEqual(['b7']);
    expect(result.removedWorktrees).toEqual(['/repo/wt7']);

    const removeCall = recorded.find((c) => c.cmd === 'git' && c.args.join(' ') === 'worktree remove /repo/wt7');
    const deleteCall = recorded.find((c) => c.cmd === 'git' && c.args.join(' ') === 'branch -D b7');
    expect(removeCall).toBeDefined();
    expect(deleteCall).toBeDefined();
    expect((removeCall?.opts as { shell?: boolean }).shell).toBe(false);
    expect((deleteCall?.opts as { shell?: boolean }).shell).toBe(false);
  });

  it('doubt is never selectable even if forced into opts.categories', () => {
    const plan = execPlan({
      branches: [
        {
          branch: 'bd', sha: 'shad', category: 'doubt',
          reason: 'open PR #9', worktree: null,
          lastCommitDate: '2026-01-01', aheadCount: 1,
        },
      ],
    });
    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'), // rev-parse --git-common-dir
      fakeSpawn(''),            // git worktree prune
    );
    const { deps } = makeExecDeps(plan, spawn);
    const opts = { categories: ['doubt'], worktreeFamilies: [], planId: TEST_PLAN_ID } as unknown as ExecuteOptions;

    const result = execute(opts, deps);

    expect(result.ok).toBe(true);
    expect(result.deletedBranches).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('worktree remove failure skips the worktree and its branch with the stderr reason; prune still runs', () => {
    const plan = execPlan({
      branches: [
        {
          branch: 'b9', sha: 'sha9', category: 'merged-ancestor',
          reason: 'tip is an ancestor of origin/main', worktree: '/repo/wt9',
          lastCommitDate: '2026-01-01', aheadCount: 1,
        },
      ],
      worktrees: [
        {
          path: '/repo/wt9', branch: 'b9', sha: 'sha9', family: 'superset',
          removable: true, reason: 'clean, inactive, unlocked',
        },
      ],
    });
    const liveWorktreeOutput = [
      'worktree /repo',
      'HEAD mainsha1234567890abcdef1234567890abcdef12',
      'branch refs/heads/main',
      '',
      'worktree /repo/wt9',
      'HEAD sha9',
      'branch refs/heads/b9',
      '',
    ].join('\n');
    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'),                          // rev-parse --git-common-dir
      fakeSpawn(''),                                     // lsof -a -d cwd -Fn
      fakeSpawn(liveWorktreeOutput),                      // git worktree list --porcelain
      fakeSpawn(''),                                      // git -C /repo/wt9 status --porcelain (clean)
      fakeSpawn('', 'fatal: unable to remove', 1),        // git worktree remove /repo/wt9 (fails)
      fakeSpawn(''),                                      // git worktree prune
    );
    const { deps, calls } = makeExecDeps(plan, spawn);
    const opts: ExecuteOptions = {
      branches: [], categories: ['merged-ancestor'], worktreeFamilies: ['superset'], planId: TEST_PLAN_ID,
    };

    const result = execute(opts, deps);

    expect(result.ok).toBe(true);
    expect(result.removedWorktrees).toEqual([]);
    expect(result.deletedBranches).toEqual([]);
    expect(result.skipped).toEqual(expect.arrayContaining([
      { item: '/repo/wt9', reason: 'fatal: unable to remove' },
      { item: 'b9', reason: 'fatal: unable to remove' },
    ]));
    expect(calls).toContain('spawn:git worktree prune');
  });

  it("branch delete failure skips the branch with the stderr reason; undo line was already appended", () => {
    const plan = execPlan({
      branches: [
        {
          branch: 'b10', sha: 'sha10', category: 'merged-ancestor',
          reason: 'tip is an ancestor of origin/main', worktree: null,
          lastCommitDate: '2026-01-01', aheadCount: 1,
        },
      ],
    });
    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'),                                       // rev-parse --git-common-dir
      fakeSpawn('sha10'),                                             // git rev-parse refs/heads/b10 (unchanged)
      fakeSpawn(''),                                                  // git merge-base --is-ancestor sha10 origin/main
      fakeSpawn('', 'error: cannot lock ref', 1),                     // git branch -D b10 (fails)
      fakeSpawn(''),                                                  // git worktree prune
    );
    const { deps, calls, appended } = makeExecDeps(plan, spawn);
    const opts: ExecuteOptions = { branches: [], categories: ['merged-ancestor'], worktreeFamilies: [], planId: TEST_PLAN_ID };

    const result = execute(opts, deps);

    expect(result.ok).toBe(true);
    expect(result.deletedBranches).toEqual([]);
    expect(result.skipped).toEqual([{ item: 'b10', reason: 'error: cannot lock ref' }]);
    expect(appended).toEqual(['b10 sha10\n']);

    const appendIdx = calls.indexOf('append:b10 sha10');
    const deleteIdx = calls.indexOf('spawn:git branch -D b10');
    expect(appendIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(-1);
    expect(appendIdx).toBeLessThan(deleteIdx);
  });

  // Regression: a merged-ancestor branch whose local tip is AHEAD of its
  // stale remote-tracking ref. `git branch -d` refuses these ("not fully
  // merged to <upstream>") even though every commit is already in
  // origin/main, so the category could never actually be deleted. The
  // ancestry re-verify proves the real predicate and -D acts on it.
  it('deletes a merged-ancestor branch that is ahead of its stale upstream', () => {
    const plan = execPlan({
      branches: [
        {
          branch: 'ahead-of-upstream', sha: 'sha11', category: 'merged-ancestor',
          reason: 'tip is an ancestor of origin/main', worktree: null,
          lastCommitDate: '2026-01-01', aheadCount: 1,
        },
      ],
    });
    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'), // rev-parse --git-common-dir
      fakeSpawn('sha11'),       // git rev-parse refs/heads/ahead-of-upstream
      fakeSpawn(''),            // git merge-base --is-ancestor sha11 origin/main (exit 0)
      fakeSpawn(''),            // git branch -D ahead-of-upstream
      fakeSpawn(''),            // git worktree prune
    );
    const { deps, calls } = makeExecDeps(plan, spawn);
    const opts: ExecuteOptions = { branches: [], categories: ['merged-ancestor'], worktreeFamilies: [], planId: TEST_PLAN_ID };

    const result = execute(opts, deps);

    expect(result.ok).toBe(true);
    expect(result.deletedBranches).toEqual(['ahead-of-upstream']);
    expect(result.skipped).toEqual([]);
    expect(calls).not.toContain('spawn:git branch -d ahead-of-upstream');
  });

  it('skips an ancestor-proven branch whose ancestry no longer holds at execute time', () => {
    const plan = execPlan({
      branches: [
        {
          branch: 'b12', sha: 'sha12', category: 'empty',
          reason: 'no upstream, no commits beyond main', worktree: null,
          lastCommitDate: '2026-01-01', aheadCount: 1,
        },
      ],
    });
    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'),   // rev-parse --git-common-dir
      fakeSpawn('sha12'),         // git rev-parse refs/heads/b12 (sha unchanged)
      fakeSpawn('', '', 1),       // git merge-base --is-ancestor sha12 origin/main (exit 1: main rewound)
      fakeSpawn(''),              // git worktree prune
    );
    const { deps, appended } = makeExecDeps(plan, spawn);
    const opts: ExecuteOptions = { branches: [], categories: ['empty'], worktreeFamilies: [], planId: TEST_PLAN_ID };

    const result = execute(opts, deps);

    expect(result.ok).toBe(true);
    expect(result.deletedBranches).toEqual([]);
    expect(result.skipped).toEqual([
      { item: 'b12', reason: 'no longer an ancestor of origin/main — re-run classify' },
    ]);
    // The undo line must NOT be written for a branch that was never deleted.
    expect(appended).toEqual([]);
  });

  it('re-verifies a superseded branch against origin/main before deleting it', () => {
    const plan = execPlan({
      branches: [
        {
          branch: 'b13', sha: 'sha13', category: 'superseded',
          reason: '2 touched file(s), none still differ from origin/main', worktree: null,
          lastCommitDate: '2025-12-01', aheadCount: 2,
        },
      ],
    });
    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'),      // rev-parse --git-common-dir
      fakeSpawn('sha13'),            // git rev-parse refs/heads/b13
      fakeSpawn('src/a.ts'),         // git diff --name-only origin/main...sha13
      fakeSpawn('docs/other.md'),    // git diff --name-only origin/main..sha13
      fakeSpawn(''),                 // git branch -D b13
      fakeSpawn(''),                 // git worktree prune
    );
    const { deps, calls } = makeExecDeps(plan, spawn);
    const opts: ExecuteOptions = {
      branches: [], categories: ['superseded'], worktreeFamilies: [], planId: TEST_PLAN_ID,
    };

    const result = execute(opts, deps);

    expect(result.deletedBranches).toEqual(['b13']);
    expect(calls).toContain('spawn:git diff --name-only origin/main...sha13');
    // No ancestry check: a superseded tip is deliberately NOT an ancestor.
    expect(calls.some((c) => c.includes('merge-base'))).toBe(false);
  });

  it('skips a superseded branch whose content now differs from a moved origin/main', () => {
    const plan = execPlan({
      branches: [
        {
          branch: 'b14', sha: 'sha14', category: 'superseded',
          reason: '2 touched file(s), none still differ from origin/main', worktree: null,
          lastCommitDate: '2025-12-01', aheadCount: 2,
        },
      ],
    });
    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'),   // rev-parse --git-common-dir
      fakeSpawn('sha14'),         // git rev-parse refs/heads/b14
      fakeSpawn('src/a.ts'),      // diff --name-only origin/main...sha14
      fakeSpawn('src/a.ts'),      // diff --name-only origin/main..sha14 — now differs
      fakeSpawn(''),              // git worktree prune
    );
    const { deps, appended } = makeExecDeps(plan, spawn);
    const opts: ExecuteOptions = {
      branches: [], categories: ['superseded'], worktreeFamilies: [], planId: TEST_PLAN_ID,
    };

    const result = execute(opts, deps);

    expect(result.deletedBranches).toEqual([]);
    expect(result.skipped).toEqual([
      { item: 'b14', reason: 'content no longer matches origin/main — re-run classify' },
    ]);
    expect(appended).toEqual([]);
  });

  // --branches: the reviewed-doubt path. Everything the category path
  // enforces still runs; only the "which items" question is answered by name.
  it('deletes an explicitly named doubt branch, with undo line and sha re-verify', () => {
    const plan = execPlan({
      branches: [
        {
          branch: 'ancient', sha: 'sha15', category: 'doubt',
          reason: 'no upstream, 2 unique commit(s)', worktree: null,
          lastCommitDate: '2025-03-14', aheadCount: 2, doubtClass: 'review',
        },
      ],
    });
    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'), // rev-parse --git-common-dir
      fakeSpawn('sha15'),       // git rev-parse refs/heads/ancient
      fakeSpawn(''),            // git branch -D ancient
      fakeSpawn(''),            // git worktree prune
    );
    const { deps, calls, appended } = makeExecDeps(plan, spawn);
    const opts: ExecuteOptions = {
      branches: ['ancient'], categories: [], worktreeFamilies: [], planId: TEST_PLAN_ID,
    };

    const result = execute(opts, deps);

    expect(result.deletedBranches).toEqual(['ancient']);
    expect(appended).toEqual(['ancient sha15\n']);
    expect(calls.indexOf('append:ancient sha15')).toBeLessThan(calls.indexOf('spawn:git branch -D ancient'));
    // A doubt carries no ancestry or content proof, so neither is re-asserted.
    expect(calls.some((c) => c.includes('merge-base') || c.includes('diff'))).toBe(false);
  });

  it('skips a named branch that is not in the plan — this is how protected branches stay unreachable', () => {
    const plan = execPlan({ branches: [], protected: [{ branch: 'main', reason: 'main branch' }] });
    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'), // rev-parse --git-common-dir
      fakeSpawn(''),            // git worktree prune
    );
    const { deps, appended } = makeExecDeps(plan, spawn);
    const opts: ExecuteOptions = {
      branches: ['main', 'never-existed'], categories: [], worktreeFamilies: [], planId: TEST_PLAN_ID,
    };

    const result = execute(opts, deps);

    expect(result.deletedBranches).toEqual([]);
    expect(result.skipped).toEqual([
      { item: 'main', reason: 'not in the plan — protected, unknown, or created since classify' },
      { item: 'never-existed', reason: 'not in the plan — protected, unknown, or created since classify' },
    ]);
    expect(appended).toEqual([]);
  });

  it('naming a branch cannot force removal of a worktree someone is working in', () => {
    const plan = execPlan({
      branches: [
        {
          branch: 'wip', sha: 'sha16', category: 'doubt',
          reason: 'no upstream, 5 unique commit(s)', worktree: '/repo/wt16',
          lastCommitDate: '2026-08-01', aheadCount: 5, doubtClass: 'review',
        },
      ],
      worktrees: [
        {
          path: '/repo/wt16', branch: 'wip', sha: 'sha16', family: 'superset',
          removable: false, reason: 'uncommitted changes present',
        },
      ],
    });
    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'),        // rev-parse --git-common-dir
      fakeSpawn(''),                   // lsof
      fakeSpawn(WORKTREE_OUTPUT),      // git worktree list --porcelain
      fakeSpawn(' M src/foo.ts'),      // git status --porcelain in /repo/wt16 (dirty)
      fakeSpawn(''),                   // git worktree prune
    );
    const { deps, appended } = makeExecDeps(plan, spawn);
    const opts: ExecuteOptions = {
      branches: ['wip'], categories: [], worktreeFamilies: ['superset'], planId: TEST_PLAN_ID,
    };

    const result = execute(opts, deps);

    expect(result.deletedBranches).toEqual([]);
    expect(result.removedWorktrees).toEqual([]);
    expect(result.skipped).toEqual([
      { item: '/repo/wt16', reason: 'uncommitted changes present' },
      { item: 'wip', reason: 'uncommitted changes present' },
    ]);
    expect(appended).toEqual([]);
  });

  it('does not delete a named branch twice when its category was also approved', () => {
    const plan = execPlan({
      branches: [
        {
          branch: 'b17', sha: 'sha17', category: 'merged-pr',
          reason: 'PR #1 merged at branch tip', worktree: null,
          lastCommitDate: '2026-01-01', aheadCount: 1,
        },
      ],
    });
    const spawn = seqSpawn(
      fakeSpawn('/repo/.git'), // rev-parse --git-common-dir
      fakeSpawn('sha17'),       // git rev-parse refs/heads/b17
      fakeSpawn(''),            // git branch -D b17
      fakeSpawn(''),            // git worktree prune
    );
    const { deps, appended } = makeExecDeps(plan, spawn);
    const opts: ExecuteOptions = {
      branches: ['b17'], categories: ['merged-pr'], worktreeFamilies: [], planId: TEST_PLAN_ID,
    };

    const result = execute(opts, deps);

    expect(result.deletedBranches).toEqual(['b17']);
    expect(appended).toEqual(['b17 sha17\n']);
  });
});
