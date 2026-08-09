/**
 * Classification and execution logic for the /git-cleanup command.
 *
 * Design spec: docs/superpowers/specs/2026-08-08-git-cleanup-command-design.md
 *
 * Safety invariant: execute() re-verifies through the SAME predicate
 * functions classify() uses. Do not add a parallel implementation of any
 * deletability or protection check.
 */

import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { run, type SpawnDeps, type SpawnFn } from './shared.js';

export type Category = 'merged-ancestor' | 'merged-pr' | 'empty' | 'superseded' | 'doubt';
export type WorktreeFamily = 'superset' | 'agent' | 'chain' | 'other';

/**
 * Triage bucket for a doubt. `keep` means the doubt names live work or an
 * unresolved question elsewhere (open PR, unreadable GitHub state, a
 * worktree still in use) — reading it every run is noise, and it is never a
 * deletion candidate. `review` means the branch is plausibly dead but
 * nothing proved it: the operator decides, and acts through
 * `execute --branches=`. Report-only either way; no code path deletes on
 * the strength of a doubtClass.
 */
export type DoubtClass = 'keep' | 'review';

export interface BranchInfo {
  name: string;
  sha: string;
  upstream: string | null;
  upstreamGone: boolean;
  /** Committer date of the branch tip, `YYYY-MM-DD`. Triage signal only. */
  lastCommitDate: string;
}

export interface WorktreeInfo {
  path: string;
  sha: string;
  branch: string | null;
  locked: boolean;
  prunable: boolean;
}

/** The `--format` parseBranchRefs expects. Keep the two in lockstep. */
export const BRANCH_REF_FORMAT =
  '%(refname:short)%09%(objectname)%09%(upstream:short)%09%(upstream:track)%09%(committerdate:short)';

/** Parse `git for-each-ref refs/heads --format=BRANCH_REF_FORMAT`. */
export function parseBranchRefs(output: string): BranchInfo[] {
  return output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [name, sha, upstream, track, committerDate] = line.split('\t');
      return {
        name,
        sha,
        upstream: upstream ? upstream : null,
        upstreamGone: track === '[gone]',
        lastCommitDate: committerDate ?? '',
      };
    });
}

/** Parse `git worktree list --porcelain` blocks. */
export function parseWorktrees(output: string): WorktreeInfo[] {
  const result: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> | null = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), branch: null, locked: false, prunable: false };
    }
    else if (current && line.startsWith('HEAD ')) current.sha = line.slice('HEAD '.length);
    else if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    }
    else if (current && (line === 'locked' || line.startsWith('locked '))) current.locked = true;
    else if (current && (line === 'prunable' || line.startsWith('prunable '))) current.prunable = true;
    else if (current && line.trim() === '') {
      result.push(current as WorktreeInfo);
      current = null;
    }
  }
  if (current) result.push(current as WorktreeInfo);
  return result;
}

/**
 * Chain worktrees are provisioned one directory per epic — `pv-jdot-chains`,
 * `pv-federation-chains`, and whatever the next epic is called. Matching a
 * single hard-coded directory name left every other epic's worktrees in
 * `other`, where nothing can ever act on them; the pattern matches the
 * convention instead of one instance of it.
 */
const CHAIN_DIR_PATTERN = /\/pv-[^/]+-chains\//;

export function worktreeFamily(path: string): WorktreeFamily {
  if (path.includes('/.superset/worktrees/')) return 'superset';
  if (path.includes('/.claude/worktrees/')) return 'agent';
  if (CHAIN_DIR_PATTERN.test(path)) return 'chain';
  return 'other';
}

export interface PrInfo {
  number: number;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  headRefOid: string;
}

/** Per-branch PR lookup result. 'lookup-failed' → classify as doubt, never merged. */
export type PrLookup = Map<string, PrInfo[] | 'lookup-failed'>;

export function parseOriginUrl(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function buildPrQuery(branches: string[], owner: string, repo: string): string {
  const fields = branches
    .map((name, i) => {
      const escaped = name.replace(/"/g, '\\"');
      return `    b${i}: pullRequests(headRefName: "${escaped}", states: [OPEN, MERGED, CLOSED], first: 10) { nodes { number state headRefOid } }`;
    })
    .join('\n');
  return `query {\n  repository(owner: "${owner}", name: "${repo}") {\n${fields}\n  }\n}`;
}

export function parsePrResponse(json: unknown, branches: string[]): PrLookup {
  const map: PrLookup = new Map();
  const repository = (json as { data?: { repository?: Record<string, { nodes?: PrInfo[] }> } })
    ?.data?.repository;
  if (!repository) {
    for (const b of branches) map.set(b, 'lookup-failed');
    return map;
  }
  branches.forEach((name, i) => {
    const nodes = repository[`b${i}`]?.nodes;
    map.set(name, Array.isArray(nodes) ? nodes : 'lookup-failed');
  });
  return map;
}

export interface ContentEquivalence {
  /** True when nothing the branch carries is missing from origin/main. */
  equivalent: boolean;
  /** Files the branch changed relative to its merge base with origin/main. */
  touchedCount: number;
}

export type GitRunner = (args: string[]) => { stdout: string; stderr: string; exitCode: number };

function fileSet(stdout: string): Set<string> {
  return new Set(stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0));
}

/**
 * Decide whether `ref` still carries content that origin/main does not.
 *
 * Two name-only diffs:
 *   `origin/main...ref` — files the branch changed since the merge base
 *   `origin/main..ref`  — files whose content differs between the two tips
 * When no touched file appears in the second set, every file the branch
 * changed is byte-identical to main's copy, so the branch's work is already
 * in main (squash-merged, cherry-picked, or independently reimplemented) and
 * deleting the ref loses only its commit history. This is the single
 * definition of the `superseded` category — classify() proves it and
 * execute() re-asserts it live through this same function.
 *
 * Fails closed: any git error, or a branch that touched nothing at all,
 * returns `equivalent: false`. An empty touched set means the diff could not
 * distinguish the branch from its base, which is not evidence of anything.
 */
export function contentEquivalence(ref: string, runGit: GitRunner): ContentEquivalence {
  const touchedResult = runGit(['diff', '--name-only', `origin/main...${ref}`]);
  if (touchedResult.exitCode !== 0) return { equivalent: false, touchedCount: 0 };
  const touched = fileSet(touchedResult.stdout);
  if (touched.size === 0) return { equivalent: false, touchedCount: 0 };

  const differingResult = runGit(['diff', '--name-only', `origin/main..${ref}`]);
  if (differingResult.exitCode !== 0) return { equivalent: false, touchedCount: touched.size };
  const differing = fileSet(differingResult.stdout);

  for (const file of touched) {
    if (differing.has(file)) return { equivalent: false, touchedCount: touched.size };
  }
  return { equivalent: true, touchedCount: touched.size };
}

export interface Classified {
  category: Category;
  reason: string;
  /** Set only when `category` is 'doubt'. See DoubtClass. */
  doubtClass?: DoubtClass;
}

/**
 * Assign one category per branch. `prs` is null for ancestors (no GitHub
 * lookup needed), 'lookup-failed' when GitHub could not be consulted —
 * which is always a doubt, never an assumed merge. `content` is the
 * contentEquivalence() verdict, or null when the probe was skipped because
 * an earlier rule already decided the branch (see classify() step 9b).
 *
 * Decision order matters and is asserted by test. In particular an OPEN PR
 * outranks content equivalence: deleting the branch would close a PR
 * somebody is still using, whatever the file contents say.
 */
export function classifyBranch(
  branch: BranchInfo,
  isAncestor: boolean,
  aheadCount: number,
  prs: PrInfo[] | 'lookup-failed' | null,
  content: ContentEquivalence | null = null,
): Classified {
  if (isAncestor) {
    return branch.upstream === null
      ? { category: 'empty', reason: 'no upstream, no commits beyond main' }
      : { category: 'merged-ancestor', reason: 'tip is an ancestor of origin/main' };
  }
  if (prs === 'lookup-failed' || prs === null) {
    return {
      category: 'doubt',
      reason: 'GitHub PR lookup failed — cannot prove merge',
      doubtClass: 'keep',
    };
  }
  const mergedAtTip = prs.find((p) => p.state === 'MERGED' && p.headRefOid === branch.sha);
  if (mergedAtTip) {
    return { category: 'merged-pr', reason: `PR #${mergedAtTip.number} merged at branch tip` };
  }
  const open = prs.find((p) => p.state === 'OPEN');
  if (open) {
    return { category: 'doubt', reason: `open PR #${open.number}`, doubtClass: 'keep' };
  }
  if (content?.equivalent) {
    return {
      category: 'superseded',
      reason: `${content.touchedCount} touched file(s), none still differ from origin/main`,
    };
  }
  const merged = prs.find((p) => p.state === 'MERGED');
  if (merged) {
    return {
      category: 'doubt',
      reason: `ahead of merged PR #${merged.number} — has commits after the merge`,
      doubtClass: 'review',
    };
  }
  const closed = prs.find((p) => p.state === 'CLOSED');
  if (closed) {
    return {
      category: 'doubt',
      reason: `PR #${closed.number} closed without merging`,
      doubtClass: 'review',
    };
  }
  if (branch.upstream === null) {
    return {
      category: 'doubt',
      reason: `no upstream, ${aheadCount} unique commit(s)`,
      doubtClass: 'review',
    };
  }
  return {
    category: 'doubt',
    reason: `${branch.upstreamGone ? 'upstream gone' : 'unmerged'}, ${aheadCount} commit(s) not on main, no PR found`,
    doubtClass: 'review',
  };
}

export const MTIME_THRESHOLD_MS = 30 * 60_000;

/** Any `git status --porcelain` output means uncommitted changes. */
export function isDirty(statusOutput: string): boolean {
  return statusOutput.trim().length > 0;
}

/**
 * mtime guard: catches a worktree provisioned for an agent that has not
 * started working yet (no live process, nothing dirty). Complements the
 * lsof check, which only sees processes running right now.
 */
export function isRecentlyModified(mtimesMs: number[], nowMs: number): boolean {
  return mtimesMs.some((m) => nowMs - m < MTIME_THRESHOLD_MS);
}

/** Parse `lsof -a -d cwd -Fn` output: n-prefixed lines are cwd paths. */
export function parseCwdPaths(lsofOutput: string): string[] {
  return lsofOutput
    .split('\n')
    .filter((line) => line.startsWith('n'))
    .map((line) => line.slice(1));
}

/** True when any live process has its cwd at or inside the worktree. */
export function isActiveWorktree(path: string, cwds: string[]): boolean {
  return cwds.some((cwd) => cwd === path || cwd.startsWith(`${path}/`));
}

export interface WorktreeChecks {
  locked: boolean;
  dirty: boolean;
  recentlyModified: boolean;
  active: boolean;
  isCurrentSession: boolean;
  isPrimary: boolean;
  /**
   * True when the worktree's checked-out branch was itself classified
   * deletable (`merged-ancestor`, `merged-pr`, or `empty`). A detached
   * worktree (no branch) is never deletable. Design spec ("Worktree
   * handling", condition 1): a worktree is removed only when its branch is
   * classified deletable AND it passes every other safety check below.
   */
  branchDeletable: boolean;
}

/**
 * Single source of truth for worktree-removal safety. classify() and
 * execute()'s re-verify both call this — never fork the logic.
 */
export function assessWorktree(checks: WorktreeChecks): { removable: boolean; reason: string } {
  if (checks.isPrimary) return { removable: false, reason: 'primary checkout — never removed' };
  if (checks.isCurrentSession) return { removable: false, reason: 'current session worktree — never removed' };
  if (!checks.branchDeletable) return { removable: false, reason: 'branch not classified deletable' };
  if (checks.locked) return { removable: false, reason: 'worktree is locked' };
  if (checks.dirty) return { removable: false, reason: 'uncommitted changes present' };
  if (checks.active) return { removable: false, reason: 'live process has cwd inside worktree' };
  if (checks.recentlyModified) return { removable: false, reason: 'modified within the last 30 minutes' };
  return { removable: true, reason: 'clean, inactive, unlocked' };
}

// =============================================================================
// Plan assembly, report rendering, and classify() orchestration
// =============================================================================

export interface BranchPlanItem {
  branch: string;
  sha: string;
  category: Category;
  reason: string;
  worktree: string | null;
  /** Committer date of the tip, `YYYY-MM-DD` — the first thing an operator triaging doubts asks for. */
  lastCommitDate: string;
  /** Commits on the branch that are not on origin/main. 0 for ancestors. */
  aheadCount: number;
  /** Present only on doubts. See DoubtClass. */
  doubtClass?: DoubtClass;
}

export interface WorktreePlanItem {
  path: string;
  branch: string | null;
  sha: string;
  family: WorktreeFamily;
  removable: boolean;
  reason: string;
}

export interface CleanupPlan {
  /**
   * Random nonce, one per classify run. The plan file is shared across
   * every worktree in the repo (keyed off the common git dir) — without an
   * identity check, a concurrent session's classify would silently clobber
   * this one's plan, and execute could act on approvals the current user
   * never gave. execute() refuses to run unless its --plan-id matches.
   */
  planId: string;
  createdAt: string;
  mainSha: string;
  branches: BranchPlanItem[];
  worktrees: WorktreePlanItem[];
  protected: { branch: string; reason: string }[];
}

const DELETABLE_CATEGORIES: Category[] = ['merged-ancestor', 'merged-pr', 'empty', 'superseded'];
const ALL_CATEGORIES: Category[] = ['merged-ancestor', 'merged-pr', 'empty', 'superseded', 'doubt'];

/**
 * Categories whose classification rests on `tip is an ancestor of
 * origin/main` — the two branches of the same `isAncestor` test in
 * classifyBranch, differing only in whether an upstream is configured.
 * execute() re-asserts that ancestry live before deleting either.
 * `merged-pr` is absent: it is GitHub-proven, not ancestry-proven, and its
 * tip is deliberately NOT an ancestor of main (squash/rebase merges).
 */
const ANCESTOR_PROVEN_CATEGORIES: Category[] = ['merged-ancestor', 'empty'];

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function mdTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '_none_\n';
  const headerLine = `| ${headers.join(' | ')} |`;
  const dividerLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const rowLines = rows.map((r) => `| ${r.join(' | ')} |`);
  return [headerLine, dividerLine, ...rowLines].join('\n') + '\n';
}

/**
 * The ONLY Markdown formatter for a CleanupPlan. Never build a second
 * serialization of the plan elsewhere (spec) — the report is always
 * `renderReport(plan)`.
 */
export function renderReport(plan: CleanupPlan): string {
  const sections: string[] = [];

  sections.push(`# Git Cleanup Plan — ${plan.createdAt}\n\nmain @ \`${shortSha(plan.mainSha)}\`\n`);

  const summaryRows = ALL_CATEGORIES.map((cat) => [
    cat,
    String(plan.branches.filter((b) => b.category === cat).length),
  ]);
  sections.push(`## Summary\n\n${mdTable(['Category', 'Count'], summaryRows)}`);

  const deletableSections = DELETABLE_CATEGORIES
    .map((cat) => {
      const items = plan.branches.filter((b) => b.category === cat);
      if (items.length === 0) return '';
      const rows = items.map((b) => [
        b.branch, shortSha(b.sha), b.lastCommitDate, b.reason, b.worktree ?? '_none_',
      ]);
      return `### ${cat}\n\n${mdTable(['Branch', 'SHA', 'Last commit', 'Reason', 'Worktree'], rows)}`;
    })
    .filter((s) => s.length > 0)
    .join('\n');
  sections.push(`## Deletable branches\n\n${deletableSections || '_none_\n'}`);

  const removableWorktrees = plan.worktrees.filter((w) => w.removable);
  const worktreeRows = removableWorktrees.map((w) => [
    w.family, w.path, w.branch ?? '_detached_', shortSha(w.sha), w.reason,
  ]);
  sections.push(`## Worktree removals\n\n${mdTable(['Family', 'Path', 'Branch', 'SHA', 'Reason'], worktreeRows)}`);

  // Doubts split by triage bucket. A flat list mixes branches nobody may
  // touch (open PR, live worktree) with the ones actually awaiting a
  // decision — on a real repo the keep rows outnumber the review rows and
  // re-reading them every run is what makes the section get skimmed.
  const doubtBranches = plan.branches.filter((b) => b.category === 'doubt');
  const doubtRows = (items: BranchPlanItem[]) =>
    items.map((b) => [b.branch, shortSha(b.sha), b.lastCommitDate, String(b.aheadCount), b.reason]);
  const doubtHeaders = ['Branch', 'SHA', 'Last commit', 'Ahead', 'Reason'];

  // Oldest first: age is the strongest cheap signal that a branch is dead.
  const review = doubtBranches
    .filter((b) => b.doubtClass === 'review')
    .sort((a, b) => a.lastCommitDate.localeCompare(b.lastCommitDate));
  const keep = doubtBranches.filter((b) => b.doubtClass !== 'review');

  const nonRemovableWorktrees = plan.worktrees.filter((w) => !w.removable);
  const nonRemovableWorktreeRows = nonRemovableWorktrees.map((w) => [w.path, shortSha(w.sha), w.reason]);

  sections.push([
    '## Doubts\n',
    '### Review — no proof either way, oldest first\n',
    'Nothing here is deletable by category. After reviewing, delete by name:',
    '`execute --branches=<a,b,c> --plan-id=<id>`.\n',
    mdTable(doubtHeaders, doubtRows(review)),
    '\n### Keep — active work or unreadable state\n',
    mdTable(doubtHeaders, doubtRows(keep)),
    '\n### Worktrees not removable\n',
    mdTable(['Path', 'SHA', 'Reason'], nonRemovableWorktreeRows),
  ].join('\n'));

  const protectedRows = plan.protected.map((p) => [p.branch, p.reason]);
  sections.push(`## Protected\n\n${mdTable(['Branch', 'Reason'], protectedRows)}`);

  return sections.join('\n');
}

export interface ClassifyDeps extends SpawnDeps {
  nowMs?: () => number;
  cwd?: string;
  statMtimes?: (path: string) => number[];
  writeFile?: (path: string, content: string) => void;
  /**
   * Canonicalize a path through the filesystem (default fs.realpathSync,
   * falling back to the input path on error). lsof reports kernel-canonical
   * cwds while `git worktree list` reports creation-time paths — a
   * symlinked ancestor makes the two disagree unless both sides are
   * resolved through the same realpath call before comparison.
   */
  realpath?: (p: string) => string;
  /** Injectable plan-id generator (default `crypto.randomUUID`). */
  planId?: () => string;
}

function defaultRealpath(p: string): string {
  try {
    return fs.realpathSync(p);
  }
  catch {
    return p;
  }
}

function defaultStatMtimes(commonDir: string) {
  return (worktreePath: string): number[] => {
    const candidates = [
      worktreePath,
      path.join(commonDir, 'worktrees', path.basename(worktreePath), 'index'),
    ];
    const mtimes: number[] = [];
    for (const candidate of candidates) {
      try {
        mtimes.push(fs.statSync(candidate).mtimeMs);
      }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    return mtimes;
  };
}

export interface WorktreeCheckContext {
  spawn: SpawnFn;
  cwd?: string;
  statMtimes: (path: string) => number[];
  nowMs: number;
  /** Realpath-resolved lsof cwd list, gathered once per classify/execute call. */
  cwds: string[];
  realpath: (p: string) => string;
}

/**
 * Gather the WorktreeChecks for a single non-primary worktree. This is the
 * ONLY place these checks are gathered — classify() and Task 6's execute()
 * re-verify both call this, so a predicate change only needs to happen here.
 */
export function gatherWorktreeChecks(
  wt: WorktreeInfo,
  isPrimary: boolean,
  isCurrentSession: boolean,
  branchDeletable: boolean,
  ctx: WorktreeCheckContext,
): WorktreeChecks {
  // mtimes must be read BEFORE the status call below: plain `git status
  // --porcelain` opportunistically rewrites <commonDir>/worktrees/<name>/index
  // even when nothing changed, which would bump the very mtime the 30-minute
  // guard reads. Reading mtimes first, and passing --no-optional-locks to
  // status as a second, independent guard, closes this both ways.
  const recentlyModified = isRecentlyModified(ctx.statMtimes(wt.path), ctx.nowMs);
  const statusResult = run(
    'git',
    ['--no-optional-locks', '-C', wt.path, 'status', '--porcelain'],
    ctx.spawn,
    { cwd: ctx.cwd, shell: false },
  );
  // A non-zero exit means we could not determine cleanliness — fail closed
  // (treat as dirty) rather than assume the worktree is safe to remove.
  const dirty = statusResult.exitCode !== 0 || isDirty(statusResult.stdout);
  const resolvedPath = ctx.realpath(wt.path);
  const active = isActiveWorktree(resolvedPath, ctx.cwds);
  return {
    locked: wt.locked,
    dirty,
    recentlyModified,
    active,
    isCurrentSession,
    isPrimary,
    branchDeletable,
  };
}

/**
 * Find the worktree that most specifically contains `targetPath` (realpath
 * -equal to, or nested inside, the worktree's path). Nested worktrees (e.g.
 * agent worktrees under `<repo>/.claude/worktrees/agent-*`) live INSIDE the
 * primary checkout, so a naive first-match would always return the primary
 * — longest matching path wins (most-specific-wins), so a cwd inside a
 * nested worktree resolves to that worktree, not its ancestor.
 */
function findContainingWorktree(
  targetPath: string,
  worktrees: WorktreeInfo[],
  realpath: (p: string) => string,
): WorktreeInfo | undefined {
  const resolvedTarget = realpath(targetPath);
  let best: WorktreeInfo | undefined;
  let bestPathLength = -1;
  for (const wt of worktrees) {
    const resolvedWt = realpath(wt.path);
    if (!isActiveWorktree(resolvedWt, [resolvedTarget])) continue;
    if (resolvedWt.length > bestPathLength) {
      best = wt;
      bestPathLength = resolvedWt.length;
    }
  }
  return best;
}

/**
 * Orchestrate the full classify pass: fetch, read branch/worktree state,
 * classify every branch and worktree, write the plan/report, and return a
 * summary. See the 13-step sequence in the task-5 brief for the exact call
 * order — seqSpawn-style tests depend on it.
 */
export function classify(deps: ClassifyDeps = {}): {
  ok: boolean;
  plan?: CleanupPlan;
  planPath?: string;
  reportPath?: string;
  summary?: Record<Category, number>;
  error?: string;
} {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const cwd = deps.cwd ?? process.cwd();
  const runGit = (args: string[], opts: { timeout?: number } = {}) =>
    run('git', args, spawn, { cwd, shell: false, ...opts });

  // Step 1: file locations + inside-work-tree guard.
  const commonDirResult = runGit(['rev-parse', '--git-common-dir']);
  if (commonDirResult.exitCode !== 0) {
    return { ok: false, error: `git rev-parse --git-common-dir failed: ${commonDirResult.stderr}` };
  }
  const commonDir = path.resolve(cwd, commonDirResult.stdout);

  const insideWorkTree = runGit(['rev-parse', '--is-inside-work-tree']);
  if (insideWorkTree.exitCode !== 0 || insideWorkTree.stdout !== 'true') {
    return { ok: false, error: 'not inside a git work tree' };
  }

  // Step 2: fetch. Never assume merged on GitHub failure, but a failed
  // fetch means we cannot trust local refs against origin at all — hard stop.
  const fetchResult = runGit(['fetch', '--prune', 'origin'], { timeout: 120_000 });
  if (fetchResult.exitCode !== 0) {
    return { ok: false, error: `git fetch --prune origin failed: ${fetchResult.stderr}` };
  }

  // Step 3: main sha.
  const mainShaResult = runGit(['rev-parse', 'origin/main']);
  if (mainShaResult.exitCode !== 0) {
    return { ok: false, error: `git rev-parse origin/main failed: ${mainShaResult.stderr}` };
  }
  const mainSha = mainShaResult.stdout;

  // Step 4: all local branch refs.
  const refsResult = runGit(['for-each-ref', 'refs/heads', `--format=${BRANCH_REF_FORMAT}`]);
  const branches = parseBranchRefs(refsResult.stdout);

  // Step 5: ancestor set.
  const mergedResult = runGit(['for-each-ref', 'refs/heads', '--merged', 'origin/main', '--format=%(refname:short)']);
  const ancestorSet = new Set(
    mergedResult.stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0),
  );

  // Step 6: worktrees. First entry is the primary checkout.
  const worktreeResult = runGit(['worktree', 'list', '--porcelain']);
  const worktrees = parseWorktrees(worktreeResult.stdout);
  const primaryWt = worktrees[0];

  const realpath = deps.realpath ?? defaultRealpath;
  const sessionWt = findContainingWorktree(cwd, worktrees, realpath);

  // Step 7: protected set. main, primary checkout's branch, current session
  // branch. These bypass classifyBranch entirely.
  const protectedEntries: { branch: string; reason: string }[] = [];
  const protectedNames = new Set<string>();
  const addProtected = (branchName: string | null | undefined, reason: string) => {
    if (!branchName || protectedNames.has(branchName)) return;
    protectedNames.add(branchName);
    protectedEntries.push({ branch: branchName, reason });
  };
  addProtected('main', 'main branch');
  addProtected(primaryWt?.branch, "primary checkout's branch");
  addProtected(sessionWt?.branch, 'current session branch');

  const nonAncestorBranches = branches.filter(
    (b) => !ancestorSet.has(b.name) && !protectedNames.has(b.name),
  );

  // Step 8: ahead counts for non-ancestor, non-protected branches.
  const aheadCounts = new Map<string, number>();
  for (const b of nonAncestorBranches) {
    const result = runGit(['rev-list', '--count', `origin/main..${b.name}`]);
    aheadCounts.set(b.name, result.exitCode === 0 ? (parseInt(result.stdout, 10) || 0) : 0);
  }

  // Step 9: PR lookup for the same set. gh failure never means "assume
  // merged" — a failed chunk marks its branches 'lookup-failed' (doubt).
  // Overall `ok` stays true: PR-dependent branches degrade to doubt, but
  // git-only classification (ancestors, empties) still succeeds.
  const prLookup: PrLookup = new Map();
  if (nonAncestorBranches.length > 0) {
    const names = nonAncestorBranches.map((b) => b.name);
    const originUrlResult = runGit(['remote', 'get-url', 'origin']);
    const parsedOrigin = originUrlResult.exitCode === 0 ? parseOriginUrl(originUrlResult.stdout) : null;
    if (!parsedOrigin) {
      for (const name of names) prLookup.set(name, 'lookup-failed');
    }
    else {
      for (const branchChunk of chunk(names, 50)) {
        const query = buildPrQuery(branchChunk, parsedOrigin.owner, parsedOrigin.repo);
        const ghResult = run('gh', ['api', 'graphql', '-f', `query=${query}`], spawn, {
          cwd, timeout: 60_000, shell: false,
        });
        if (ghResult.exitCode !== 0) {
          for (const name of branchChunk) prLookup.set(name, 'lookup-failed');
          continue;
        }
        let json: unknown;
        try {
          json = JSON.parse(ghResult.stdout);
        }
        catch {
          for (const name of branchChunk) prLookup.set(name, 'lookup-failed');
          continue;
        }
        for (const [name, val] of parsePrResponse(json, branchChunk)) prLookup.set(name, val);
      }
    }
  }

  // Step 9b: content-equivalence probe, two diffs per branch. Only run where
  // it can change the verdict — the skip conditions below mirror the rules
  // that outrank `superseded` in classifyBranch, so a branch already decided
  // by GitHub state costs nothing here.
  const contentByBranch = new Map<string, ContentEquivalence>();
  for (const b of nonAncestorBranches) {
    const prs = prLookup.get(b.name);
    if (prs === undefined || prs === 'lookup-failed') continue;
    if (prs.some((p) => p.state === 'MERGED' && p.headRefOid === b.sha)) continue;
    if (prs.some((p) => p.state === 'OPEN')) continue;
    contentByBranch.set(b.name, contentEquivalence(b.name, (args) => runGit(args)));
  }

  // Step 10: classify every non-protected branch.
  const branchPlanItems: BranchPlanItem[] = branches
    .filter((b) => !protectedNames.has(b.name))
    .map((b) => {
      const isAncestor = ancestorSet.has(b.name);
      const aheadCount = isAncestor ? 0 : (aheadCounts.get(b.name) ?? 0);
      const prs = isAncestor ? null : (prLookup.get(b.name) ?? 'lookup-failed');
      const content = contentByBranch.get(b.name) ?? null;
      const classified = classifyBranch(b, isAncestor, aheadCount, prs, content);
      const wt = worktrees.find((w) => w.branch === b.name);
      return {
        branch: b.name,
        sha: b.sha,
        category: classified.category,
        reason: classified.reason,
        worktree: wt ? wt.path : null,
        lastCommitDate: b.lastCommitDate,
        aheadCount,
        ...(classified.doubtClass ? { doubtClass: classified.doubtClass } : {}),
      };
    });

  // Step 11: per non-primary worktree, gather checks and assess.
  const nowMs = (deps.nowMs ?? Date.now)();
  const statMtimes = deps.statMtimes ?? defaultStatMtimes(commonDir);
  const nonPrimaryWorktrees = worktrees.slice(1);

  let cwds: string[] = [];
  if (nonPrimaryWorktrees.length > 0) {
    // lsof routinely exits non-zero on macOS (permission-denied reading some
    // processes' fds) while still printing every cwd it *could* read on
    // stdout. Parse stdout regardless of exit code — an empty cwd list only
    // when stdout itself is empty, never inferred from the exit code alone.
    const lsofResult = run('lsof', ['-a', '-d', 'cwd', '-Fn'], spawn, { cwd, timeout: 15_000, shell: false });
    cwds = parseCwdPaths(lsofResult.stdout).map((p) => realpath(p));
  }

  const worktreePlanItems: WorktreePlanItem[] = nonPrimaryWorktrees.map((wt) => {
    const isCurrentSession = wt === sessionWt;
    // Worktree handling condition 1 (design spec): only removable when its
    // checked-out branch was itself classified deletable. A detached
    // worktree (wt.branch === null) or one whose branch is protected/doubt
    // is never branch-deletable. branchDeletable is intentionally read from
    // the ORIGINAL (pre-downgrade) branch category below — the downgrade
    // pass runs after this map, so using it here would recurse.
    const branchItem = wt.branch ? branchPlanItems.find((b) => b.branch === wt.branch) : undefined;
    const branchDeletable = branchItem !== undefined && DELETABLE_CATEGORIES.includes(branchItem.category);
    const checks = gatherWorktreeChecks(wt, false, isCurrentSession, branchDeletable, {
      spawn, cwd, statMtimes, nowMs, cwds, realpath,
    });
    const family = worktreeFamily(wt.path);
    // 'other'-family worktrees can never be approved (execute()'s
    // worktree-family allowlist is superset/agent/chain only) — mark them
    // non-removable here so the plan's removable counts match what execute
    // can actually do, regardless of what assessWorktree would otherwise say.
    const assessment = family === 'other'
      ? { removable: false, reason: 'worktree family not managed' }
      : assessWorktree(checks);
    return {
      path: wt.path,
      branch: wt.branch,
      sha: wt.sha,
      family,
      removable: assessment.removable,
      reason: assessment.reason,
    };
  });

  // Step 11b: downgrade deletable branches whose worktree can't actually be
  // removed. Without this, a branch could be reported (and approved) as
  // deletable while its checked-out worktree blocks the delete — the
  // design spec lists "dirty worktree" and "active worktree" as BRANCH
  // doubt reasons for exactly this case. 'branch not classified deletable'
  // is excluded because that's the worktree's OWN classification following
  // the branch, not an independent reason to doubt the branch.
  for (const item of branchPlanItems) {
    if (!DELETABLE_CATEGORIES.includes(item.category)) continue;
    const wtItem = worktreePlanItems.find((w) => w.path === item.worktree);
    if (!wtItem || wtItem.removable || wtItem.reason === 'branch not classified deletable') continue;
    item.category = 'doubt';
    item.reason = `worktree: ${wtItem.reason}`;
    // 'keep', not 'review': the branch proved deletable and only its
    // worktree blocks it. Nothing to decide — clear the worktree and the
    // next classify moves it back to a deletable category on its own.
    item.doubtClass = 'keep';
  }

  // Step 12: assemble and write.
  const plan: CleanupPlan = {
    planId: (deps.planId ?? randomUUID)(),
    createdAt: new Date(nowMs).toISOString(),
    mainSha,
    branches: branchPlanItems,
    worktrees: worktreePlanItems,
    protected: protectedEntries,
  };

  const planPath = path.join(commonDir, 'git-cleanup-plan.json');
  const reportPath = path.join(commonDir, 'git-cleanup-report.md');
  const writeFile = deps.writeFile ?? ((p: string, content: string) => fs.writeFileSync(p, content));
  writeFile(planPath, JSON.stringify(plan, null, 2));
  writeFile(reportPath, renderReport(plan));

  // Step 13: summary.
  const summary: Record<Category, number> = {
    'merged-ancestor': 0, 'merged-pr': 0, empty: 0, superseded: 0, doubt: 0,
  };
  for (const b of branchPlanItems) summary[b.category]++;

  return { ok: true, plan, planPath, reportPath, summary };
}

// =============================================================================
// execute() — re-verify, delete, undo log
// =============================================================================

/**
 * A plan older than this is refused outright. Per-item re-verify (rev-parse
 * for branches, gatherWorktreeChecks/assessWorktree for worktrees) already
 * guards against anything re-verify CAN see changing between classify and
 * execute. This gate exists for what re-verify cannot see: brand-new
 * branches/worktrees created since classify, or an approval given by a user
 * looking at context that's no longer representative of the repo.
 */
export const PLAN_MAX_AGE_MS = 60 * 60_000;

export function isPlanStale(createdAt: string, nowMs: number): boolean {
  const createdMs = new Date(createdAt).getTime();
  // An unparseable/corrupt createdAt yields NaN, and NaN comparisons are
  // always false — that would fail OPEN (treated as fresh). Treat anything
  // non-finite as stale instead, so a corrupt plan is refused, not trusted.
  if (!Number.isFinite(createdMs)) return true;
  return nowMs - createdMs > PLAN_MAX_AGE_MS;
}

const VALID_EXECUTE_CATEGORIES: Category[] = ['merged-ancestor', 'merged-pr', 'empty', 'superseded'];
const VALID_WORKTREE_FAMILIES: WorktreeFamily[] = ['superset', 'agent', 'chain'];

export interface ExecuteOptions {
  categories: Category[];
  worktreeFamilies: WorktreeFamily[];
  /**
   * Branches named one by one, after the operator reviewed the report's
   * doubts. A doubt is still never deletable BY CATEGORY — this is the
   * narrower claim "I looked at this specific branch and I want it gone",
   * and it exists because the alternative is a hand-rolled `git branch -D`
   * loop that gets no re-verify, no protections, and no undo log. Every
   * other guard still applies: the branch must be in the plan (so protected
   * branches are unreachable), its sha must still match, and a branch
   * checked out in a worktree still needs that worktree to pass the full
   * removal assessment.
   */
  branches: string[];
  /** Must match the loaded plan's `planId` — see CleanupPlan.planId. */
  planId: string;
}

export interface ExecuteDeps extends SpawnDeps {
  nowMs?: () => number;
  cwd?: string;
  statMtimes?: (path: string) => number[];
  readFile?: (path: string) => string;
  appendFile?: (path: string, line: string) => void;
  /** See ClassifyDeps.realpath — same canonicalization need on the execute-side re-verify. */
  realpath?: (p: string) => string;
}

export interface ExecuteResult {
  ok: boolean;
  deletedBranches: string[];
  removedWorktrees: string[];
  skipped: { item: string; reason: string }[];
  undoLogPath: string | null;
  error?: string;
}

/**
 * Parse `execute` CLI args: `--categories=a,b` and/or `--branches=x,y` (at
 * least one of the two, non-empty), `--worktree-families=x,y` (optional,
 * defaults to no families approved), and `--plan-id=<id>` (required — must
 * match the classify output the user approved; see CleanupPlan.planId).
 * `doubt` is rejected as a CATEGORY here so it can never be bulk-selected —
 * `execute` itself also filters it defensively for callers that bypass this
 * parser. Individual doubt branches remain reachable through `--branches`;
 * see ExecuteOptions.branches.
 */
export function parseExecuteArgs(argv: string[]): ExecuteOptions | { error: string } {
  let categoriesRaw: string | undefined;
  let branchesRaw: string | undefined;
  let familiesRaw: string | undefined;
  let planId: string | undefined;
  for (const arg of argv) {
    if (arg.startsWith('--categories=')) categoriesRaw = arg.slice('--categories='.length);
    else if (arg.startsWith('--branches=')) branchesRaw = arg.slice('--branches='.length);
    else if (arg.startsWith('--worktree-families=')) familiesRaw = arg.slice('--worktree-families='.length);
    else if (arg.startsWith('--plan-id=')) planId = arg.slice('--plan-id='.length);
  }

  const categories = (categoriesRaw ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  const branches = (branchesRaw ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (categories.length === 0 && branches.length === 0) {
    return { error: 'one of --categories or --branches is required (comma-separated, non-empty)' };
  }
  for (const c of categories) {
    if (c === 'doubt') return { error: 'doubt is never selectable as a category — name individual branches with --branches' };
    if (!VALID_EXECUTE_CATEGORIES.includes(c as Category)) return { error: `unknown category: ${c}` };
  }

  const families = (familiesRaw ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  for (const f of families) {
    if (!VALID_WORKTREE_FAMILIES.includes(f as WorktreeFamily)) return { error: `unknown worktree family: ${f}` };
  }

  if (!planId) return { error: '--plan-id is required (copy it from the classify output — re-run classify if you don\'t have one)' };

  return {
    categories: categories as Category[],
    branches,
    worktreeFamilies: families as WorktreeFamily[],
    planId,
  };
}

function formatDateStamp(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Re-verify and execute an approved plan: delete branches, remove worktrees,
 * append an undo log line before each branch deletion. Every safety check
 * runs through `gatherWorktreeChecks` + `assessWorktree` — the same
 * functions classify() uses (see file-header invariant). A skipped item is
 * never fatal; `ok: false` is reserved for "could not even attempt this run"
 * (no plan, stale plan).
 */
export function execute(opts: ExecuteOptions, deps: ExecuteDeps = {}): ExecuteResult {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const cwd = deps.cwd ?? process.cwd();
  const runGit = (args: string[], runOpts: { timeout?: number } = {}) =>
    run('git', args, spawn, { cwd, shell: false, ...runOpts });
  const nowMs = (deps.nowMs ?? Date.now)();
  const realpath = deps.realpath ?? defaultRealpath;
  const readFile = deps.readFile ?? ((p: string) => fs.readFileSync(p, 'utf-8'));
  const appendFile = deps.appendFile ?? ((p: string, line: string) => fs.appendFileSync(p, line));

  const fail = (error: string): ExecuteResult => ({
    ok: false, deletedBranches: [], removedWorktrees: [], skipped: [], undoLogPath: null, error,
  });

  // Step 1: locate and load the plan.
  const commonDirResult = runGit(['rev-parse', '--git-common-dir']);
  if (commonDirResult.exitCode !== 0) {
    return fail(`git rev-parse --git-common-dir failed: ${commonDirResult.stderr}`);
  }
  const commonDir = path.resolve(cwd, commonDirResult.stdout);
  // Matches classify's default: mtime is checked on the worktree root AND
  // <common-dir>/worktrees/<basename>/index, so this must be keyed off
  // commonDir, not cwd (deps.statMtimes ignores this entirely — tests always
  // inject their own).
  const statMtimes = deps.statMtimes ?? defaultStatMtimes(commonDir);
  const planPath = path.join(commonDir, 'git-cleanup-plan.json');

  let planText: string;
  try {
    planText = readFile(planPath);
  }
  catch {
    return fail('no plan file — run classify first');
  }

  let plan: CleanupPlan;
  try {
    plan = JSON.parse(planText) as CleanupPlan;
  }
  catch {
    return fail('plan file is not valid JSON — re-run classify');
  }

  // Step 1b: plan-identity gate. The plan file is shared across every
  // worktree in the repo (keyed off the common git dir) — without this, a
  // concurrent session's classify could silently replace the plan this
  // session's user approved, and execute would act on approvals nobody
  // actually gave for the plan now on disk.
  if (!opts.planId || opts.planId !== plan.planId) {
    return fail('plan id mismatch — re-run classify and re-approve');
  }

  // Step 2: staleness gate.
  if (isPlanStale(plan.createdAt, nowMs)) {
    return fail('plan is older than 60 minutes — re-run classify');
  }

  const undoLogPath = path.join(commonDir, `git-cleanup-undo-${formatDateStamp(nowMs)}.log`);

  // Step 3: select branch items — approved categories, plus any branch named
  // explicitly. doubt is never selectable by CATEGORY (parseExecuteArgs
  // already rejects it; execute() defends independently for callers that
  // bypass the CLI parser), but an explicitly named doubt is allowed: see
  // ExecuteOptions.branches.
  const approvedCategories = opts.categories.filter((c) => c !== 'doubt');
  const byCategory = plan.branches.filter(
    (b) => b.category !== 'doubt' && approvedCategories.includes(b.category),
  );

  const skipped: { item: string; reason: string }[] = [];

  const namedBranches = opts.branches ?? [];
  const selectedNames = new Set(byCategory.map((b) => b.branch));
  const selected = [...byCategory];
  for (const name of namedBranches) {
    if (selectedNames.has(name)) continue;
    const item = plan.branches.find((b) => b.branch === name);
    if (!item) {
      // Protected branches are never written into plan.branches, so this is
      // also how `--branches=main` gets refused.
      skipped.push({ item: name, reason: 'not in the plan — protected, unknown, or created since classify' });
      continue;
    }
    selectedNames.add(name);
    selected.push(item);
  }
  const removedWorktrees: string[] = [];

  const withoutWorktree = selected.filter((b) => b.worktree === null);
  const withWorktree = selected.filter((b) => b.worktree !== null);

  // Step 4a: family gate — a checked-out branch cannot be deleted, so an
  // unapproved family skips both the worktree and its branch immediately,
  // before any live re-verify call.
  const familyApproved: BranchPlanItem[] = [];
  for (const b of withWorktree) {
    const wtPlanItem = plan.worktrees.find((w) => w.path === b.worktree);
    const family = wtPlanItem?.family ?? 'other';
    if (!opts.worktreeFamilies.includes(family)) {
      skipped.push({ item: b.worktree as string, reason: 'worktree family not approved' });
      skipped.push({ item: b.branch, reason: 'worktree family not approved' });
      continue;
    }
    familyApproved.push(b);
  }

  // Step 4b: one fresh lsof call covers every worktree being re-verified
  // this run (mirrors classify's batching — see gatherWorktreeChecks caller
  // contract).
  let cwds: string[] = [];
  if (familyApproved.length > 0) {
    const lsofResult = run('lsof', ['-a', '-d', 'cwd', '-Fn'], spawn, { cwd, timeout: 15_000, shell: false });
    cwds = parseCwdPaths(lsofResult.stdout).map((p) => realpath(p));
  }

  // isCurrentSession must be derived LIVE, not assumed false. Between plan
  // approval and execute running, the user may have cd'd into a candidate
  // worktree — lsof is not a complete substitute (it fails open when
  // absent/permission-limited, and a shell sitting at a prompt has no
  // listed fd at all). Re-run `git worktree list --porcelain` fresh and
  // reuse findContainingWorktree — the SAME longest-match containment
  // classify() uses to compute its own sessionWt — rather than forking a
  // second containment check.
  let sessionWt: WorktreeInfo | undefined;
  if (familyApproved.length > 0) {
    const worktreeListResult = runGit(['worktree', 'list', '--porcelain']);
    if (worktreeListResult.exitCode !== 0) {
      // Can't re-derive the current-session worktree without this — failing
      // open here would mean the current-session protection silently does
      // not apply, and a worktree remove could target the session itself.
      return fail('could not re-read worktree list — re-run classify');
    }
    const liveWorktrees = parseWorktrees(worktreeListResult.stdout);
    sessionWt = findContainingWorktree(cwd, liveWorktrees, realpath);
  }

  // Step 4c: per approved-family worktree, re-verify via gatherWorktreeChecks
  // + assessWorktree — the same predicate classify() used to write
  // `removable: true` into the plan. isPrimary is always false and
  // branchDeletable is always true here: a worktree whose branch was
  // protected could never have reached `selected` (protected branches never
  // appear in plan.branches), and every other branch that reached it either
  // proved deletable or was named explicitly, which is the operator making
  // the same call. Every live condition — dirty, active, recently modified
  // — is still re-checked below, so naming a branch cannot force the
  // removal of a worktree somebody is working in. `locked` isn't part of the
  // brief's re-verify set (dirty/active/recentlyModified only) — a lock
  // acquired after classify is a gap the mtime/active checks don't close,
  // but re-checking it isn't in scope for this task.
  const branchDeleteCandidates: BranchPlanItem[] = [...withoutWorktree];
  for (const b of familyApproved) {
    const wtInfo: WorktreeInfo = {
      path: b.worktree as string, sha: b.sha, branch: b.branch, locked: false, prunable: false,
    };
    const isCurrentSession = sessionWt !== undefined && realpath(wtInfo.path) === realpath(sessionWt.path);
    const checks = gatherWorktreeChecks(wtInfo, false, isCurrentSession, true, {
      spawn, cwd, statMtimes, nowMs, cwds, realpath,
    });
    const assessment = assessWorktree(checks);
    if (!assessment.removable) {
      skipped.push({ item: b.worktree as string, reason: assessment.reason });
      skipped.push({ item: b.branch, reason: assessment.reason });
      continue;
    }
    const removeResult = runGit(['worktree', 'remove', b.worktree as string]);
    if (removeResult.exitCode !== 0) {
      skipped.push({ item: b.worktree as string, reason: removeResult.stderr });
      skipped.push({ item: b.branch, reason: removeResult.stderr });
      continue;
    }
    removedWorktrees.push(b.worktree as string);
    branchDeleteCandidates.push(b);
  }

  // Step 5: re-verify each surviving branch's sha, append the undo line
  // BEFORE deleting, then delete.
  const deletedBranches: string[] = [];
  for (const b of branchDeleteCandidates) {
    const revParseResult = runGit(['rev-parse', `refs/heads/${b.branch}`]);
    if (revParseResult.exitCode !== 0 || revParseResult.stdout !== b.sha) {
      skipped.push({ item: b.branch, reason: 'branch moved since classify' });
      continue;
    }
    // `git branch -d` is the wrong safety net for an ancestor-proven
    // category. It measures merged-ness against the branch's own upstream,
    // not against main, so a branch whose local tip is ahead of a stale
    // remote-tracking ref is refused even when every commit it carries is
    // already in origin/main — which is exactly what classify proved. Re-
    // assert that predicate live instead, then delete with -D. This is
    // strictly stronger than -d: it proves merged-to-main rather than
    // merged-to-upstream, and it also covers `empty`, which previously got
    // -D on the strength of the plan alone.
    if (ANCESTOR_PROVEN_CATEGORIES.includes(b.category)) {
      // Exit 0 = ancestor, 1 = not, >1 = git error (bad ref, missing
      // origin/main). Every non-zero case skips, so this fails safe.
      const ancestorResult = runGit(['merge-base', '--is-ancestor', b.sha, 'origin/main']);
      if (ancestorResult.exitCode !== 0) {
        skipped.push({ item: b.branch, reason: 'no longer an ancestor of origin/main — re-run classify' });
        continue;
      }
    }
    // `superseded` rests on a diff against origin/main, and origin/main can
    // move between classify and execute. Re-assert it through the same
    // function classify used, against the sha just re-verified above.
    if (b.category === 'superseded') {
      const recheck = contentEquivalence(b.sha, (args) => runGit(args));
      if (!recheck.equivalent) {
        skipped.push({ item: b.branch, reason: 'content no longer matches origin/main — re-run classify' });
        continue;
      }
    }
    appendFile(undoLogPath, `${b.branch} ${b.sha}\n`);
    const deleteResult = runGit(['branch', '-D', b.branch]);
    if (deleteResult.exitCode !== 0) {
      skipped.push({ item: b.branch, reason: deleteResult.stderr });
      continue;
    }
    deletedBranches.push(b.branch);
  }

  // Step 6: prune unconditionally.
  runGit(['worktree', 'prune']);

  // Step 7: totals. Skips are reported, never fatal.
  return { ok: true, deletedBranches, removedWorktrees, skipped, undoLogPath };
}
