/**
 * Integration tests for .claude/skills/git-cleanup/scripts/lib/git-cleanup.ts against a REAL git
 * binary and real repositories in a temp directory.
 *
 * Why this file exists: the unit suite injects a fake spawn, so it can only
 * assert which commands were issued — never how git actually answers them.
 * That gap shipped a bug. `git branch -d` measures merged-ness against the
 * branch's own upstream, so it refused every `merged-ancestor` branch whose
 * local tip was ahead of a stale remote-tracking ref, and the first live run
 * of /git-cleanup deleted nothing at all. Call-order assertions could not
 * see it; a temp repo does.
 *
 * Only `gh` is faked here (no network, no auth): it answers "no PRs" for
 * every branch it is asked about, which is exactly the state of a local
 * branch that was never pushed for review.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { classify, execute, type ExecuteOptions } from '../lib/git-cleanup.js';

let root: string;
let repo: string;
let origin: string;

/** Run a real git command, throwing on failure. */
function git(args: string[], cwd = repo): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${result.status}): ${result.stderr}`);
  }
  return result.stdout.trim();
}

/** Run a real git command, returning the raw result (may fail). */
function gitTry(args: string[], cwd = repo) {
  return spawnSync('git', args, { cwd, encoding: 'utf-8' });
}

function write(file: string, content: string): void {
  fs.writeFileSync(path.join(repo, file), content);
}

function commit(message: string): void {
  git(['add', '-A']);
  git(['commit', '-m', message]);
}

/**
 * spawn stub: real git, faked gh. The gh fake reads the aliases out of the
 * GraphQL query it was handed and answers each with an empty node list —
 * parsePrResponse treats a missing alias as 'lookup-failed', so the aliases
 * have to be echoed back for the "no PR" case to be modelled honestly.
 */
function spawnFn(cmd: string, args: readonly string[], opts: Record<string, unknown>) {
  // The temp remote is a local bare repo, so `git remote get-url` returns a
  // filesystem path and parseOriginUrl correctly refuses it — which would
  // mark every branch 'lookup-failed' and short-circuit the very
  // classification under test. Report a GitHub-shaped URL for that one
  // query; every other git call is real.
  if (cmd === 'git' && args.includes('get-url')) {
    const url = 'git@github.com:test/repo.git';
    return {
      stdout: Buffer.from(url), stderr: Buffer.from(''), status: 0,
      signal: null, pid: 1, output: [null, Buffer.from(url), Buffer.from('')],
    };
  }
  if (cmd === 'gh') {
    const query = args.find((a) => a.startsWith('query=')) ?? '';
    const aliases = [...query.matchAll(/\b(b\d+):/g)].map((m) => m[1]);
    const repository = Object.fromEntries(aliases.map((a) => [a, { nodes: [] }]));
    const json = JSON.stringify({ data: { repository } });
    return {
      stdout: Buffer.from(json), stderr: Buffer.from(''), status: 0,
      signal: null, pid: 1, output: [null, Buffer.from(json), Buffer.from('')],
    };
  }
  return spawnSync(cmd, args as string[], opts as never);
}

function runClassify() {
  return classify({
    spawnFn: spawnFn as never,
    cwd: repo,
  });
}

function runExecute(over: Partial<ExecuteOptions>) {
  const plan = runClassify();
  const result = execute(
    {
      categories: [], branches: [], worktreeFamilies: [],
      planId: plan.plan?.planId as string,
      ...over,
    },
    { spawnFn: spawnFn as never, cwd: repo },
  );
  return { plan, result };
}

function branchExists(name: string): boolean {
  return gitTry(['rev-parse', '--verify', `refs/heads/${name}`]).status === 0;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'git-cleanup-it-'));
  origin = path.join(root, 'origin.git');
  repo = path.join(root, 'work');

  spawnSync('git', ['init', '--bare', '--initial-branch=main', origin]);
  spawnSync('git', ['init', '--initial-branch=main', repo]);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['remote', 'add', 'origin', origin]);

  write('README.md', 'base\n');
  commit('base');
  git(['push', '-u', 'origin', 'main']);

  // 1. feat.landed — merged into main, but its remote-tracking ref is stale.
  //    Push commit A, add commit B locally, then merge B into main. Every
  //    commit is in origin/main; origin/feat.landed still points at A.
  git(['checkout', '-b', 'feat.landed']);
  write('landed.txt', 'A\n');
  commit('landed A');
  git(['push', '-u', 'origin', 'feat.landed']);
  write('landed.txt', 'A\nB\n');
  commit('landed B');
  git(['checkout', 'main']);
  git(['merge', '--no-ff', '-m', 'merge feat.landed', 'feat.landed']);
  git(['push', 'origin', 'main']);

  // 2. feat.squashed — squash-merged into main. Not an ancestor of main, but
  //    every file it touched is now byte-identical to main's copy.
  git(['checkout', '-b', 'feat.squashed']);
  write('squashed.txt', 'squashed content\n');
  commit('squashed work');
  git(['checkout', 'main']);
  git(['merge', '--squash', 'feat.squashed']);
  commit('squash feat.squashed');
  git(['push', 'origin', 'main']);

  // 3. feat.live — real work that is in no sense in main.
  git(['checkout', '-b', 'feat.live']);
  write('live.txt', 'unmerged work\n');
  commit('live work');
  git(['checkout', 'main']);

  git(['fetch', '--prune', 'origin']);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('git-cleanup against a real repository', () => {
  it('classifies each branch by what git actually reports', () => {
    const result = runClassify();

    expect(result.ok).toBe(true);
    const byName = Object.fromEntries((result.plan?.branches ?? []).map((b) => [b.branch, b]));
    expect(byName['feat.landed'].category).toBe('merged-ancestor');
    expect(byName['feat.squashed'].category).toBe('superseded');
    expect(byName['feat.live'].category).toBe('doubt');
    expect(byName['feat.live'].doubtClass).toBe('review');
    // main is protected, never classified.
    expect(byName.main).toBeUndefined();
    expect(result.summary).toMatchObject({ 'merged-ancestor': 1, superseded: 1, doubt: 1 });
  });

  it('reads the tip date and ahead count off real refs', () => {
    const plan = runClassify().plan;
    const live = plan?.branches.find((b) => b.branch === 'feat.live');
    expect(live?.lastCommitDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(live?.aheadCount).toBe(1);
  });

  // The regression that motivated this file.
  it('git branch -d still refuses the merged-ancestor branch — and execute deletes it anyway', () => {
    const refusal = gitTry(['branch', '-d', 'feat.landed']);
    expect(refusal.status).not.toBe(0);
    expect(refusal.stderr).toContain('not fully merged');
    expect(branchExists('feat.landed')).toBe(true);

    const { result } = runExecute({ categories: ['merged-ancestor'] });

    expect(result.ok).toBe(true);
    expect(result.deletedBranches).toEqual(['feat.landed']);
    expect(result.skipped).toEqual([]);
    expect(branchExists('feat.landed')).toBe(false);
  });

  it('deletes a squash-merged branch through the superseded category', () => {
    const { result } = runExecute({ categories: ['superseded'] });

    expect(result.deletedBranches).toEqual(['feat.squashed']);
    expect(branchExists('feat.squashed')).toBe(false);
    // Deleting it lost no content: the file is still in main.
    expect(fs.readFileSync(path.join(repo, 'squashed.txt'), 'utf-8')).toBe('squashed content\n');
  });

  it('leaves unmerged work alone no matter which categories are approved', () => {
    const { result } = runExecute({
      categories: ['merged-ancestor', 'merged-pr', 'empty', 'superseded'],
    });

    expect(result.deletedBranches.sort()).toEqual(['feat.landed', 'feat.squashed']);
    expect(branchExists('feat.live')).toBe(true);
  });

  it('deletes a reviewed doubt by name and restores it from the undo log', () => {
    const sha = git(['rev-parse', 'refs/heads/feat.live']);

    const { result } = runExecute({ branches: ['feat.live'] });

    expect(result.deletedBranches).toEqual(['feat.live']);
    expect(branchExists('feat.live')).toBe(false);

    // The undo log is the recovery contract: `git branch <name> <sha>`.
    const log = fs.readFileSync(result.undoLogPath as string, 'utf-8');
    const [name, loggedSha] = log.trim().split('\n').pop()!.split(' ');
    expect(name).toBe('feat.live');
    expect(loggedSha).toBe(sha);

    git(['branch', name, loggedSha]);
    expect(git(['rev-parse', 'refs/heads/feat.live'])).toBe(sha);
    // The restored ref carries the work, not just the name.
    expect(git(['show', `${sha}:live.txt`])).toBe('unmerged work');
  });

  it('refuses to delete main even when it is named explicitly', () => {
    const { result } = runExecute({ branches: ['main'] });

    expect(result.deletedBranches).toEqual([]);
    expect(result.skipped[0].reason).toContain('not in the plan');
    expect(branchExists('main')).toBe(true);
  });

  it('skips a branch that moved between classify and execute', () => {
    const plan = runClassify();
    // Someone commits to the branch after the plan was approved.
    git(['checkout', 'feat.squashed']);
    write('squashed.txt', 'squashed content\nplus more\n');
    commit('late work');
    git(['checkout', 'main']);

    const result = execute(
      {
        categories: ['superseded'], branches: [], worktreeFamilies: [],
        planId: plan.plan?.planId as string,
      },
      { spawnFn: spawnFn as never, cwd: repo },
    );

    expect(result.deletedBranches).toEqual([]);
    expect(result.skipped).toEqual([{ item: 'feat.squashed', reason: 'branch moved since classify' }]);
    expect(branchExists('feat.squashed')).toBe(true);
  });

  it('skips a superseded branch when origin/main moves away from its content', () => {
    const plan = runClassify();
    // main gains a conflicting change to the very file the branch touched,
    // and the branch is no longer content-equal.
    write('squashed.txt', 'rewritten on main\n');
    commit('rewrite squashed.txt');
    git(['push', 'origin', 'main']);
    git(['fetch', 'origin']);

    const result = execute(
      {
        categories: ['superseded'], branches: [], worktreeFamilies: [],
        planId: plan.plan?.planId as string,
      },
      { spawnFn: spawnFn as never, cwd: repo },
    );

    expect(result.deletedBranches).toEqual([]);
    expect(result.skipped).toEqual([
      { item: 'feat.squashed', reason: 'content no longer matches origin/main — re-run classify' },
    ]);
    expect(branchExists('feat.squashed')).toBe(true);
  });
});
