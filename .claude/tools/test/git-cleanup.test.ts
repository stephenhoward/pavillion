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
import { classifyBranch, type BranchInfo, type PrInfo } from '../lib/git-cleanup.js';

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
      'main\tabc123\torigin/main\t',
      'feat.done\tdef456\torigin/feat.done\t[gone]',
      'local-only\t789abc\t\t',
      'ahead\t111222\torigin/ahead\t[ahead 2]',
    ].join('\n');
    const refs = parseBranchRefs(output);
    expect(refs).toHaveLength(4);
    expect(refs[0]).toEqual({ name: 'main', sha: 'abc123', upstream: 'origin/main', upstreamGone: false });
    expect(refs[1]).toEqual({ name: 'feat.done', sha: 'def456', upstream: 'origin/feat.done', upstreamGone: true });
    expect(refs[2]).toEqual({ name: 'local-only', sha: '789abc', upstream: null, upstreamGone: false });
    expect(refs[3].upstreamGone).toBe(false);
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
  return { name: 'b', sha: 'aaa', upstream: 'origin/b', upstreamGone: false, ...over };
}
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
    createdAt: '2026-08-08T12:00:00.000Z',
    mainSha: 'abcdef1234567890abcdef1234567890abcdef12',
    branches: [
      {
        branch: 'feat.done',
        sha: 'aaaaaaa1111111111111111111111111111111',
        category: 'merged-ancestor',
        reason: 'tip is an ancestor of origin/main',
        worktree: null,
      },
      {
        branch: 'feat.wip',
        sha: 'bbbbbbb2222222222222222222222222222222',
        category: 'doubt',
        reason: 'open PR #42',
        worktree: '/repo/.superset/worktrees/u/wt1',
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
});

// =============================================================================
// classify
// =============================================================================

const REFS_OUTPUT = [
  'main\tmainsha1234567890abcdef1234567890abcdef12\torigin/main\t',
  'ancestor.done\taaaaaaa1111111111111111111111111111111\torigin/ancestor.done\t[gone]',
  'gone.branch\tbbbbbbb2222222222222222222222222222222\torigin/gone.branch\t[gone]',
].join('\n');

const MERGED_OUTPUT = ['main', 'ancestor.done'].join('\n');

const WORKTREE_OUTPUT = [
  'worktree /repo',
  'HEAD mainsha1234567890abcdef1234567890abcdef12',
  'branch refs/heads/main',
  '',
].join('\n');

function happyPathSpawn(ghResult: SpawnSyncReturns<Buffer>) {
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
    expect(result.summary).toEqual({ 'merged-ancestor': 1, 'merged-pr': 0, empty: 0, doubt: 1 });
    expect(result.planPath).toBe('/repo/.git/git-cleanup-plan.json');
    expect(result.reportPath).toBe('/repo/.git/git-cleanup-report.md');
    expect(written['/repo/.git/git-cleanup-plan.json']).toBeDefined();
    expect(written['/repo/.git/git-cleanup-report.md']).toBeDefined();
    expect(JSON.parse(written['/repo/.git/git-cleanup-plan.json']).mainSha).toBe(
      'mainsha1234567890abcdef1234567890abcdef12',
    );
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
      'worktree /symlink-alias/wt2',
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
      fakeSpawn(''),                                                // git -C /symlink-alias/wt2 status --porcelain
    );

    const written: Record<string, string> = {};
    const deps: ClassifyDeps = {
      spawnFn: spawn as unknown as ClassifyDeps['spawnFn'],
      cwd: '/repo',
      nowMs: () => 1_700_000_000_000,
      statMtimes: () => [],
      writeFile: (path, content) => { written[path] = content; },
      realpath: (p) => (p === '/symlink-alias/wt2' ? '/real/wt2' : p),
    };

    const result = classify(deps);

    expect(result.ok).toBe(true);
    const wt2 = result.plan?.worktrees.find((w) => w.path === '/symlink-alias/wt2');
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
    const wtPath = '/other/feat-open-wt';
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
    const wtPath = '/repo/other/wt3';
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
      fakeSpawn('n/repo/other/wt3\n', 'lsof: WARNING: ...', 1),
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
});
