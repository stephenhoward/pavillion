/**
 * Deterministic git / gh-stack helpers for agent orchestration.
 *
 * These wrappers are the ONLY place gh-stack operations are implemented
 * (anti-drift rule; conventions live in git-workflow/stacking.md). Command
 * shapes are pinned to behavior observed on gh-stack 0.0.8 (spike verified
 * 2026-07-21; see the gh-stack verification spike report and decision memo).
 *
 * Tool surface (decision memo D2): a stack exists only for dependency chains
 * of 2+ beads; independent single beads never touch gh-stack — they use
 * plain git + gh. `chained` (sourced from a stackPlan() chain's length) is
 * what lets stackCreate/stackSubmit route correctly, since both a chain head
 * and a single bead have `parent = trunk` and cannot be told apart from
 * `parent` alone.
 *
 * Exports:
 *   CLI helpers: gitSafeToStart, stackCreate, stackSubmit, syncAndRestack
 *   Pure helpers: stackPlan
 */

import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { run, type SpawnDeps } from './shared.js';

export interface GitSafeResult {
  ok: boolean;
  reason?: string;
}

export interface StackOpResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export interface SyncAndRestackResult {
  /** True when `gh stack sync --prune` exited 0 (no rebase conflict, feature enabled). */
  ok: boolean;
  /**
   * Raw exit code from `gh stack sync --prune`. gh-stack reports structured
   * exit codes: 3 = rebase conflict, 9 = feature disabled for this repo.
   */
  exitCode: number;
  /** True when the sync hit a rebase conflict (exit code 3). */
  conflicted: boolean;
  /**
   * True when the private-preview feature is disabled for this repo (exit
   * code 9). Per decision memo D5, this is a clean hard stop — `submit`/
   * `sync` either fully succeed or wholesale refuse; there is no partial or
   * corrupted state to recover from.
   */
  featureDisabled: boolean;
  /** Combined raw stdout/stderr from the sync command, for diagnostics and reporting. */
  rawOutput: string;
}

// =============================================================================
// gitSafeToStart
// =============================================================================

/**
 * Check that the working tree is clean and HEAD is current with the base
 * the next branch will be cut from.
 *
 *   - must be inside a git work tree
 *   - HEAD commit must equal the base ref (any branch name is fine)
 *   - working tree must be clean (git status --porcelain is empty)
 *
 * Without `parentBranch`, the base ref is `origin/<mainBranch>` — the
 * "current with main" model (rather than "on main") supports worktree-based
 * workflows where each worktree's branch starts at origin/main and feature
 * branches are cut from there. The env var `GIT_SAFE_MAIN_BRANCH` still
 * configures the upstream branch name (default: `main`).
 *
 * With `parentBranch` (stacking case), HEAD is compared against the LOCAL
 * parent branch tip — a mid-chain stack parent may not have been submitted
 * yet, so it may not exist on origin at all. `origin/<mainBranch>` remains
 * the comparison only for the trunk case.
 */
export function gitSafeToStart(
  parentBranch?: string,
  deps: SpawnDeps = {},
): GitSafeResult {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const mainBranch = process.env.GIT_SAFE_MAIN_BRANCH ?? 'main';
  const baseRef = parentBranch ?? `origin/${mainBranch}`;

  // Check inside work tree
  const insideRepo = run('git', ['rev-parse', '--is-inside-work-tree'], spawn);
  if (insideRepo.exitCode !== 0) {
    return { ok: false, reason: 'not inside a git work tree' };
  }

  // Check HEAD == base ref
  const headSha = run('git', ['rev-parse', 'HEAD'], spawn);
  if (headSha.exitCode !== 0) {
    return { ok: false, reason: 'git rev-parse HEAD failed unexpectedly' };
  }
  const baseSha = run('git', ['rev-parse', baseRef], spawn);
  if (baseSha.exitCode !== 0) {
    return {
      ok: false,
      reason: parentBranch
        ? `could not resolve local parent branch ${parentBranch}`
        : `could not resolve origin/${mainBranch}; check remote access`,
    };
  }
  if (headSha.stdout !== baseSha.stdout) {
    return {
      ok: false,
      reason: `HEAD is not at ${baseRef} (HEAD=${headSha.stdout.slice(0, 7)}, ${baseRef}=${baseSha.stdout.slice(0, 7)})`,
    };
  }

  // Check clean tree
  const statusResult = run('git', ['status', '--porcelain'], spawn);
  if (statusResult.exitCode !== 0) {
    return { ok: false, reason: 'git status failed unexpectedly' };
  }
  if (statusResult.stdout.length > 0) {
    return { ok: false, reason: 'working tree is dirty' };
  }

  return { ok: true };
}

// =============================================================================
// stackCreate
// =============================================================================

/**
 * Create a branch for one stack level (or a plain single-bead branch).
 *
 * Routing:
 *   - `parent` is a previously-created stack level (never trunk) → mid-chain:
 *     `gh stack add <branch>`. `gh stack add` has no `--base` flag (spike
 *     divergence #4) — it always adds on top of whatever is currently
 *     checked out.
 *   - `parent === trunk && chained` → chain head: `gh stack init --base
 *     <parent> <branch>` starts a new stack. `--base` is passed explicitly
 *     (rather than relying on gh-stack's own default) so a non-default
 *     `GIT_SAFE_MAIN_BRANCH` is honored, matching gitSafeToStart.
 *   - `parent === trunk && !chained` → single, unstacked bead: plain
 *     `git checkout -b <branch> <parent>`, no gh-stack involvement.
 *
 * PRECONDITIONS (not validated at runtime, asserted in tests):
 *   - `branch` follows git-workflow/branches.md naming.
 *   - For the mid-chain case, `parent` must be the current stack top AND
 *     currently checked out — the caller's sequential-within-chain
 *     scheduling guarantees this (`gh stack add` requires it; spike
 *     divergence #4).
 */
export function stackCreate(
  branch: string,
  parent: string,
  chained: boolean,
  deps: SpawnDeps = {},
): StackOpResult {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const mainBranch = process.env.GIT_SAFE_MAIN_BRANCH ?? 'main';

  if (parent !== mainBranch) {
    const result = run('gh', ['stack', 'add', branch], spawn, { cwd: deps.cwd });
    return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
  }

  if (chained) {
    const result = run('gh', ['stack', 'init', '--base', parent, branch], spawn, { cwd: deps.cwd });
    return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
  }

  const result = run('git', ['checkout', '-b', branch, parent], spawn, { cwd: deps.cwd });
  return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
}

// =============================================================================
// stackSubmit
// =============================================================================

/**
 * Submit a stack level (or a single-bead branch) and open/update its PR.
 *
 * Chains (`chained = true`): `gh stack submit --auto --open`. `--auto` skips
 * gh-stack's interactive editor; `--auto` alone creates new PRs as DRAFTS
 * (spike-confirmed), which violates the standing no-draft-PRs convention, so
 * `--open` is passed to suppress that. Title/body are canonicalized
 * afterwards with `gh pr edit` by the caller (gh-stack submit is
 * spike-confirmed idempotent and non-clobbering of `gh pr edit` changes
 * across re-submits).
 *
 * `--open`'s behavior on a RE-submit (PRs that already exist) was not
 * exercised by the spike — only PR *creation* was. As a safe interim
 * (decision memo D3), pair `--open` with a `gh pr ready` sweep over every PR
 * currently in the stack (via `gh stack view --json`); `gh pr ready` is a
 * no-op on an already-ready PR, so the sweep cannot violate the no-draft
 * invariant, only backstop it. Drop the sweep once `--open` is proven
 * reliable on re-submits.
 *
 * Singles (`chained = false`): plain `git push -u origin <branch>` followed
 * by `gh pr create --fill`. `--fill` (commit subject/body) is sufficient
 * because the caller overwrites title/body via `gh pr edit` immediately
 * after, exactly like the chain path.
 */
export function stackSubmit(
  branch: string,
  chained: boolean,
  deps: SpawnDeps = {},
): StackOpResult {
  const spawn = deps.spawnFn ?? nodeSpawnSync;

  if (!chained) {
    const pushResult = run('git', ['push', '-u', 'origin', branch], spawn, { timeout: 60_000, cwd: deps.cwd });
    if (pushResult.exitCode !== 0) {
      return { ok: false, stdout: pushResult.stdout, stderr: pushResult.stderr };
    }
    const createResult = run('gh', ['pr', 'create', '--fill'], spawn, { timeout: 60_000, cwd: deps.cwd });
    return {
      ok: createResult.exitCode === 0,
      stdout: [pushResult.stdout, createResult.stdout].filter(Boolean).join('\n'),
      stderr: [pushResult.stderr, createResult.stderr].filter(Boolean).join('\n'),
    };
  }

  const submitResult = run('gh', ['stack', 'submit', '--auto', '--open'], spawn, { timeout: 120_000, cwd: deps.cwd });
  if (submitResult.exitCode !== 0) {
    return { ok: false, stdout: submitResult.stdout, stderr: submitResult.stderr };
  }

  // D3 safe-interim sweep — see docstring above for the trim condition.
  const sweepErrors: string[] = [];
  const viewResult = run('gh', ['stack', 'view', '--json'], spawn, { timeout: 30_000, cwd: deps.cwd });
  if (viewResult.exitCode === 0 && viewResult.stdout) {
    try {
      const parsed = JSON.parse(viewResult.stdout) as { branches?: Array<{ pr?: { number?: number } }> };
      const prNumbers = (parsed.branches ?? [])
        .map(b => b.pr?.number)
        .filter((n): n is number => typeof n === 'number');
      for (const prNumber of prNumbers) {
        const readyResult = run('gh', ['pr', 'ready', String(prNumber)], spawn, { timeout: 30_000, cwd: deps.cwd });
        if (readyResult.exitCode !== 0) sweepErrors.push(readyResult.stderr);
      }
    }
    catch {
      sweepErrors.push('gh stack view --json unparseable; skipped gh pr ready sweep');
    }
  }
  else {
    sweepErrors.push('gh stack view --json failed; skipped gh pr ready sweep');
  }

  return {
    ok: true,
    stdout: submitResult.stdout,
    stderr: [submitResult.stderr, ...sweepErrors].filter(Boolean).join('\n'),
  };
}

// =============================================================================
// syncAndRestack
// =============================================================================

/**
 * Run `gh stack sync --prune` and report structured results keyed off
 * gh-stack's exit codes (decision memo D5's clean-hard-stop model — exit
 * codes are the documented structured-automation surface).
 *
 * `--prune` performs the full local catch-up ritual: fetch → reconcile →
 * trunk update → cascade rebase → push → PR sync → prune merged branches
 * (see git-workflow/stacking.md).
 *
 * Exit 3 = rebase conflict (`conflicted: true`). Exit 9 = the private-
 * preview feature is disabled for this repo (`featureDisabled: true`) — per
 * D5, this is a clean, pre-merge hard stop, never partial or corrupted
 * state. Callers decide what to do with either; this helper never attempts
 * resolution.
 */
export function syncAndRestack(deps: SpawnDeps = {}): SyncAndRestackResult {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const result = run('gh', ['stack', 'sync', '--prune'], spawn, { timeout: 120_000, cwd: deps.cwd });
  const rawOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');

  return {
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    conflicted: result.exitCode === 3,
    featureDisabled: result.exitCode === 9,
    rawOutput,
  };
}

// =============================================================================
// stackPlan (pure)
// =============================================================================

/**
 * A directed dependency edge between two sibling beads.
 *
 * `blocker` must complete before `blocked` can start (bd's "blocks"
 * relationship, read from the blocked bead's `dependencies` array).
 */
export interface DependencyEdge {
  /** The bead that must complete first. */
  blocker: string;
  /** The bead that is blocked until the blocker closes. */
  blocked: string;
  /**
   * bd `dependency_type` for this edge. Only `'blocks'` edges participate in
   * chain planning; anything else (e.g. `'parent-child'`) is ignored.
   * Undefined is treated as `'blocks'`.
   */
  dependencyType?: string;
}

/**
 * Result of stackPlan: an ordered forest of chains.
 */
export interface StackPlanResult {
  /**
   * Ordered forest of chains. Each chain is a linear blocker-first path
   * (`chain[0]` has no in-set blocker; each subsequent bead is blocked by
   * its predecessor). Independent beads are singleton chains.
   */
  chains: string[][];
  /**
   * True when the plan fell back to no-stack singletons because the edge
   * graph was non-linear (cycle, fork, or join). A plan with no edges at
   * all is NOT flat — it is a real plan that happens to have no stacking.
   */
  flat: boolean;
  /** Human-readable reasons for a flat fallback (empty otherwise). */
  warnings: string[];
}

/**
 * Plan dependency-chain stacks for an epic's child beads. Pure function.
 *
 * Takes the sibling bead set and the "blocks" edges among them; returns an
 * ordered forest of chains — the schedulable unit for wave orchestration
 * (see git-workflow/stacking.md for the stacking conventions the chains
 * feed). Edges referencing beads outside the sibling set, self-edges, and
 * non-'blocks' edge types are ignored.
 *
 * Any non-linear structure — a cycle, a fork (one blocker with 2+ in-set
 * dependents), or a join (one bead with 2+ in-set blockers) — falls back to
 * a flat no-stack plan (every bead a singleton) with a warning for
 * agent/human resolution. Output order is deterministic: chains appear in
 * the input order of their head bead; within a chain, blocker-first.
 *
 * The dependency parameter is named `dependencyEdges`, never `deps` —
 * `deps` is reserved codebase-wide for SpawnDeps injection.
 */
export function stackPlan(
  beads: string[],
  dependencyEdges: DependencyEdge[],
): StackPlanResult {
  const beadSet = new Set(beads);
  const flatPlan = (warnings: string[]): StackPlanResult => ({
    chains: beads.map(b => [b]),
    flat: true,
    warnings,
  });

  // Filter to in-set 'blocks' edges, dropping self-edges and duplicates.
  const seen = new Set<string>();
  const edges: Array<{ blocker: string; blocked: string }> = [];
  for (const edge of dependencyEdges) {
    if (edge.dependencyType !== undefined && edge.dependencyType !== 'blocks') continue;
    if (!beadSet.has(edge.blocker) || !beadSet.has(edge.blocked)) continue;
    if (edge.blocker === edge.blocked) continue;
    const key = `${edge.blocker}:${edge.blocked}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ blocker: edge.blocker, blocked: edge.blocked });
  }

  // Successor / predecessor maps. Linearity requires at most one of each per bead.
  const successor = new Map<string, string[]>();
  const predecessor = new Map<string, string[]>();
  for (const { blocker, blocked } of edges) {
    successor.set(blocker, [...(successor.get(blocker) ?? []), blocked]);
    predecessor.set(blocked, [...(predecessor.get(blocked) ?? []), blocker]);
  }

  const warnings: string[] = [];
  for (const [blocker, blockedList] of successor) {
    if (blockedList.length > 1) {
      warnings.push(`fork at ${blocker}: blocks ${blockedList.join(', ')} — non-linear dependency graph, falling back to flat no-stack plan`);
    }
  }
  for (const [blocked, blockerList] of predecessor) {
    if (blockerList.length > 1) {
      warnings.push(`join at ${blocked}: blocked by ${blockerList.join(', ')} — non-linear dependency graph, falling back to flat no-stack plan`);
    }
  }
  if (warnings.length > 0) {
    return flatPlan(warnings);
  }

  // Walk each chain from its head (a bead with no in-set blocker) following
  // the unique successor. Chains are emitted in input order of their head.
  const chains: string[][] = [];
  const visited = new Set<string>();
  for (const bead of beads) {
    if (predecessor.has(bead)) continue; // mid-chain or tail — reached via its head
    const chain: string[] = [];
    let current: string | undefined = bead;
    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      chain.push(current);
      current = successor.get(current)?.[0];
    }
    chains.push(chain);
  }

  // Any edge-participating bead not reached from a head sits on a cycle
  // (linear in/out degrees but no head to start from).
  const unreached = beads.filter(b => !visited.has(b));
  if (unreached.length > 0) {
    return flatPlan([
      `dependency cycle involving ${unreached.join(', ')} — falling back to flat no-stack plan`,
    ]);
  }

  return { chains, flat: false, warnings: [] };
}
