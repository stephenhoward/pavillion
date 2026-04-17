/**
 * Phase 6 -- Branch Setup.
 *
 * Prepares the git branch for bead execution. Entirely scripted (no LLM
 * dispatch) because every step is deterministic:
 *
 *   1. git-safe-to-start.sh — re-verify clean tree + main branch
 *   2. branch-name.sh <beadId> — derive the branch name
 *   3. git branch --show-current — check if already on target branch
 *   4. git checkout -b <branch> — create and switch (if needed)
 *   5. bd show --json <beadId> — determine issue_type for routing
 *
 * Routes to phase-7a-epic (epic bead) or phase-7b-leaf (everything else).
 *
 * Note: All commands in this phase emit plain text (not JSON), so this
 * module uses a local spawnCmd() helper instead of runScript() which
 * expects JSON on stdout.
 */

import { spawnSync as nodeSpawnSync, type SpawnSyncReturns } from 'node:child_process';
import { PhaseName, type RunLogger } from './context.js';
import type { OrchestratorContext, PhaseRunner } from '../process-backlog.js';

// ---------------------------------------------------------------------------
// Script paths
// ---------------------------------------------------------------------------

const GIT_SAFE_SCRIPT = '.claude/skills/bead-branch-and-pr/git-safe-to-start.sh';
const BRANCH_NAME_SCRIPT = '.claude/skills/bead-branch-and-pr/branch-name.sh';

// ---------------------------------------------------------------------------
// User-visible messages
// ---------------------------------------------------------------------------

export const BRANCH_MESSAGES = {
  unsafeDirty: (stderr: string) =>
    `UNSAFE: git-safe-to-start failed \u2014 ${stderr.trim() || 'working tree is dirty or not on main'}`,
  unsafeGit: (stderr: string) =>
    `UNSAFE: git failure \u2014 ${stderr.trim() || 'unexpected git error'}`,
  branchNameFailed: (code: number, stderr: string) =>
    `branch-name.sh failed (exit ${code}): ${stderr.trim()}`,
  checkoutFailed: (branch: string, stderr: string) =>
    `git checkout -b "${branch}" failed: ${stderr.trim()}`,
  currentBranchFailed: (stderr: string) =>
    `git branch --show-current failed: ${stderr.trim()}`,
  beadLookupFailed: (code: number, stderr: string) =>
    `bd show --json failed (exit ${code}): ${stderr.trim()}`,
} as const;

// ---------------------------------------------------------------------------
// Pure routing function
// ---------------------------------------------------------------------------

/**
 * Route to phase-7a-epic or phase-7b-leaf based on the bead's issue_type.
 *
 * Only 'epic' routes to phase-7a; everything else (task, feature, bug,
 * unknown) routes to phase-7b.
 */
export function routeToExecution(issueType: string): PhaseName {
  return issueType === 'epic' ? PhaseName.Epic : PhaseName.Leaf;
}

// ---------------------------------------------------------------------------
// Plain-text command result
// ---------------------------------------------------------------------------

interface CmdResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ---------------------------------------------------------------------------
// Deps injection for testing
// ---------------------------------------------------------------------------

export interface BranchDeps {
  /** Override spawnSync for testing. */
  spawnFn?: typeof nodeSpawnSync;
}

// ---------------------------------------------------------------------------
// Local helper: run a command and return raw stdout/stderr (no JSON parse)
// ---------------------------------------------------------------------------

/**
 * Spawn a command synchronously and return trimmed stdout/stderr.
 *
 * Unlike runScript(), this does NOT attempt JSON parsing — it returns
 * raw text output. Used for git commands and shell scripts that emit
 * plain text.
 */
function spawnCmd(
  cmd: string,
  args: string[],
  logger: RunLogger,
  logTag: PhaseName,
  spawnFn: typeof nodeSpawnSync = nodeSpawnSync,
): CmdResult {
  const result: SpawnSyncReturns<Buffer> = spawnFn(cmd, args, {
    encoding: 'buffer' as never,
    shell: true,
    timeout: 60_000,
  });

  const stdout = (result.stdout?.toString('utf-8') ?? '').trim();
  const stderr = (result.stderr?.toString('utf-8') ?? '').trim();
  const exitCode = result.status ?? 1;

  if (stdout) {
    logger.writePhaseLog(logTag, 'out', stdout + '\n');
  }
  if (stderr) {
    logger.writePhaseLog(logTag, 'err', stderr + '\n');
  }

  return { stdout, stderr, exitCode };
}

// ---------------------------------------------------------------------------
// Phase runner
// ---------------------------------------------------------------------------

export const run: PhaseRunner = async (ctx) => {
  return runBranch(ctx);
};

/**
 * Inner implementation with injectable deps for testing.
 */
export async function runBranch(
  ctx: OrchestratorContext,
  deps: BranchDeps = {},
): Promise<{ next: PhaseName | 'halt'; ctx: OrchestratorContext }> {

  const spawnFn = deps.spawnFn ?? nodeSpawnSync;
  const logger = ctx.logger;

  logger.appendRunJson({
    event: 'branch_setup_start',
    beadId: ctx.beadId,
  });

  // Step 1: Narrow safety re-check
  const safeResult = spawnCmd(GIT_SAFE_SCRIPT, [], logger, PhaseName.Branch, spawnFn);

  if (safeResult.exitCode === 2) {
    const msg = BRANCH_MESSAGES.unsafeGit(safeResult.stderr);
    console.error(msg);
    logger.writePhaseLog(PhaseName.Branch, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  if (safeResult.exitCode !== 0) {
    const msg = BRANCH_MESSAGES.unsafeDirty(safeResult.stderr);
    console.error(msg);
    logger.writePhaseLog(PhaseName.Branch, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  // Step 2: Derive branch name
  const branchCmd = spawnCmd(
    BRANCH_NAME_SCRIPT, [ctx.beadId], logger, PhaseName.Branch, spawnFn,
  );

  if (branchCmd.exitCode !== 0) {
    const msg = BRANCH_MESSAGES.branchNameFailed(branchCmd.exitCode, branchCmd.stderr);
    console.error(msg);
    logger.writePhaseLog(PhaseName.Branch, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  const branchName = branchCmd.stdout;

  // Step 3: Check if already on the target branch
  const currentCmd = spawnCmd(
    'git', ['branch', '--show-current'], logger, PhaseName.Branch, spawnFn,
  );

  if (currentCmd.exitCode !== 0) {
    const msg = BRANCH_MESSAGES.currentBranchFailed(currentCmd.stderr);
    console.error(msg);
    logger.writePhaseLog(PhaseName.Branch, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  if (currentCmd.stdout === branchName) {
    // Already on target branch — short-circuit
    logger.appendRunJson({
      event: 'branch_already_current',
      branchName,
    });

    return resolveRoute(ctx, spawnFn, logger, branchName);
  }

  // Step 4: Create and switch to the branch
  const checkoutCmd = spawnCmd(
    'git', ['checkout', '-b', branchName], logger, PhaseName.Branch, spawnFn,
  );

  if (checkoutCmd.exitCode !== 0) {
    const msg = BRANCH_MESSAGES.checkoutFailed(branchName, checkoutCmd.stderr);
    console.error(msg);
    logger.writePhaseLog(PhaseName.Branch, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  logger.appendRunJson({
    event: 'branch_created',
    branchName,
    baseBranch: 'main',
  });

  return resolveRoute(ctx, spawnFn, logger, branchName);
}

// ---------------------------------------------------------------------------
// Forward routing helper
// ---------------------------------------------------------------------------

/**
 * Determine the bead's issue_type via `bd show --json` and route to the
 * correct execution phase.
 */
async function resolveRoute(
  ctx: OrchestratorContext,
  spawnFn: typeof nodeSpawnSync,
  logger: RunLogger,
  branchName: string,
): Promise<{ next: PhaseName | 'halt'; ctx: OrchestratorContext }> {

  const bdCmd = spawnCmd(
    'bd', ['show', '--json', ctx.beadId], logger, PhaseName.Branch, spawnFn,
  );

  let issueType = 'task'; // default to leaf

  if (bdCmd.exitCode === 0 && bdCmd.stdout) {
    try {
      const parsed = JSON.parse(bdCmd.stdout) as Array<{ issue_type?: string }>;
      issueType = parsed[0]?.issue_type ?? 'task';
    }
    catch {
      // Parse failure — fall through to default (leaf)
    }
  }
  else if (bdCmd.exitCode !== 0) {
    const msg = BRANCH_MESSAGES.beadLookupFailed(bdCmd.exitCode, bdCmd.stderr);
    console.error(msg);
    logger.writePhaseLog(PhaseName.Branch, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  const next = routeToExecution(issueType);

  logger.appendRunJson({
    event: 'branch_setup_complete',
    branchName,
    issueType,
    next,
  });

  return { next, ctx };
}
