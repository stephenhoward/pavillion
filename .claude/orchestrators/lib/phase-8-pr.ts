/**
 * Phase 8 — PR Finalization.
 *
 * Entirely scripted (no LLM dispatch). Steps:
 *
 *   1. Verify every target bead is CLOSED via `bd show --json`.
 *   2. Generate PR body via `pr-body.sh`.
 *   3. Derive PR title via `commit-msg.sh` (leaf) or strip "Epic:" prefix (epic).
 *   4. Push branch: `git push -u origin <branch>`.
 *   5. Create PR: `gh pr create --title <title> --body <body>`.
 *
 * Routes to phase-9-report on success; halts on failure.
 */

import { spawnSync as nodeSpawnSync, type SpawnSyncReturns } from 'node:child_process';
import { PhaseName, type RunLogger } from './context.js';
import type { OrchestratorContext, PhaseRunner } from '../process-backlog.js';

// ---------------------------------------------------------------------------
// Script paths
// ---------------------------------------------------------------------------

const PR_BODY_SCRIPT = '.claude/skills/bead-branch-and-pr/pr-body.sh';
const COMMIT_MSG_SCRIPT = '.claude/skills/bead-branch-and-pr/commit-msg.sh';

// ---------------------------------------------------------------------------
// User-visible messages
// ---------------------------------------------------------------------------

export const PR_MESSAGES = {
  unclosedBead: (beadId: string, status: string) =>
    `UNCLOSED: bead ${beadId} has status "${status}" — expected CLOSED`,
  bdShowFailed: (beadId: string, code: number, stderr: string) =>
    `bd show --json failed for "${beadId}" (exit ${code}): ${stderr.trim()}`,
  prBodyFailed: (code: number, stderr: string) =>
    `pr-body.sh failed (exit ${code}): ${stderr.trim()}`,
  commitMsgFailed: (code: number, stderr: string) =>
    `commit-msg.sh failed (exit ${code}): ${stderr.trim()}`,
  pushFailed: (branch: string, stderr: string) =>
    `git push failed for branch "${branch}": ${stderr.trim()}`,
  ghPrFailed: (code: number, stderr: string) =>
    `gh pr create failed (exit ${code}): ${stderr.trim()}`,
  branchDetectFailed: (stderr: string) =>
    `git branch --show-current failed: ${stderr.trim()}`,
} as const;

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

export interface PRDeps {
  /** Override spawnSync for testing. */
  spawnFn?: typeof nodeSpawnSync;
}

// ---------------------------------------------------------------------------
// Local helper: run a command and return raw stdout/stderr
// ---------------------------------------------------------------------------

function spawnCmd(
  cmd: string,
  args: string[],
  logger: RunLogger,
  logTag: PhaseName,
  spawnFn: typeof nodeSpawnSync = nodeSpawnSync,
  env?: Record<string, string>,
): CmdResult {
  const result: SpawnSyncReturns<Buffer> = spawnFn(cmd, args, {
    encoding: 'buffer' as never,
    shell: true,
    timeout: 120_000,
    env: env ? { ...process.env, ...env } : undefined,
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
// Pure helper: extract bead title from bd show JSON
// ---------------------------------------------------------------------------

interface BeadJson {
  title?: string;
  status?: string;
  issue_type?: string;
  children?: Array<{ id?: string }>;
}

/**
 * Parse bd show --json output. Returns the first element of the array.
 */
export function parseBeadJson(raw: string): BeadJson | null {
  try {
    const parsed = JSON.parse(raw) as BeadJson[];
    return parsed[0] ?? null;
  }
  catch {
    return null;
  }
}

/**
 * Derive PR title from the bead.
 *
 * - For leaf beads: use commit-msg.sh to get conventional format.
 * - For epic beads: strip "Epic:" prefix from title, use as-is.
 */
export function derivePrTitleFromBead(
  title: string,
  issueType: string,
): string {
  if (issueType === 'epic') {
    return title.replace(/^Epic:\s*/i, '').trim();
  }
  // For leaf beads, the caller should use commit-msg.sh
  return title;
}

// ---------------------------------------------------------------------------
// Phase runner
// ---------------------------------------------------------------------------

export const run: PhaseRunner = async (ctx) => {
  return runPR(ctx);
};

/**
 * Inner implementation with injectable deps for testing.
 */
export async function runPR(
  ctx: OrchestratorContext,
  deps: PRDeps = {},
): Promise<{ next: PhaseName | 'halt'; ctx: OrchestratorContext }> {
  const spawnFn = deps.spawnFn ?? nodeSpawnSync;
  const logger = ctx.logger;

  logger.appendRunJson({
    event: 'pr_finalize_start',
    beadId: ctx.beadId,
  });

  // Step 0: Get current branch name
  const branchCmd = spawnCmd(
    'git', ['branch', '--show-current'], logger, PhaseName.PR, spawnFn,
  );

  if (branchCmd.exitCode !== 0) {
    const msg = PR_MESSAGES.branchDetectFailed(branchCmd.stderr);
    console.error(msg);
    logger.writePhaseLog(PhaseName.PR, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  const branchName = branchCmd.stdout;

  // Step 1: Verify bead(s) are CLOSED
  const bdResult = spawnCmd(
    'bd', ['show', '--json', ctx.beadId], logger, PhaseName.PR, spawnFn,
  );

  if (bdResult.exitCode !== 0) {
    const msg = PR_MESSAGES.bdShowFailed(ctx.beadId, bdResult.exitCode, bdResult.stderr);
    console.error(msg);
    logger.writePhaseLog(PhaseName.PR, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  const bead = parseBeadJson(bdResult.stdout);
  if (!bead) {
    const msg = PR_MESSAGES.bdShowFailed(ctx.beadId, 0, 'unparseable JSON');
    console.error(msg);
    return { next: 'halt', ctx };
  }

  const isEpic = bead.issue_type === 'epic';
  const beadsClosed: string[] = [ctx.beadId];

  // For leaf: check the bead itself is closed
  const beadStatus = (bead.status ?? '').toLowerCase();
  if (!beadStatus.includes('closed') && !beadStatus.includes('done')) {
    const msg = PR_MESSAGES.unclosedBead(ctx.beadId, bead.status ?? 'unknown');
    console.error(msg);
    logger.writePhaseLog(PhaseName.PR, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  // For epics: verify all children are also closed
  if (isEpic && bead.children && bead.children.length > 0) {
    for (const child of bead.children) {
      const childId = child.id;
      if (!childId) continue;

      beadsClosed.push(childId);

      const childResult = spawnCmd(
        'bd', ['show', '--json', childId], logger, PhaseName.PR, spawnFn,
      );

      if (childResult.exitCode !== 0) {
        const msg = PR_MESSAGES.bdShowFailed(childId, childResult.exitCode, childResult.stderr);
        console.error(msg);
        return { next: 'halt', ctx };
      }

      const childBead = parseBeadJson(childResult.stdout);
      const childStatus = (childBead?.status ?? '').toLowerCase();
      if (!childStatus.includes('closed') && !childStatus.includes('done')) {
        const msg = PR_MESSAGES.unclosedBead(childId, childBead?.status ?? 'unknown');
        console.error(msg);
        logger.writePhaseLog(PhaseName.PR, 'err', msg + '\n');
        return { next: 'halt', ctx };
      }
    }
  }

  // Step 2: Generate PR body via pr-body.sh
  const prBodyArgs = beadsClosed;
  const prBodyResult = spawnCmd(
    PR_BODY_SCRIPT, prBodyArgs, logger, PhaseName.PR, spawnFn,
  );

  if (prBodyResult.exitCode !== 0) {
    const msg = PR_MESSAGES.prBodyFailed(prBodyResult.exitCode, prBodyResult.stderr);
    console.error(msg);
    logger.writePhaseLog(PhaseName.PR, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  const prBody = prBodyResult.stdout;

  // Step 3: Derive PR title
  let prTitle: string;

  if (isEpic) {
    prTitle = derivePrTitleFromBead(bead.title ?? ctx.beadId, 'epic');
  }
  else {
    // Use commit-msg.sh for leaf beads
    const titleResult = spawnCmd(
      COMMIT_MSG_SCRIPT,
      [ctx.beadId, bead.title ?? ctx.beadId],
      logger,
      PhaseName.PR,
      spawnFn,
    );

    if (titleResult.exitCode !== 0) {
      const msg = PR_MESSAGES.commitMsgFailed(titleResult.exitCode, titleResult.stderr);
      console.error(msg);
      logger.writePhaseLog(PhaseName.PR, 'err', msg + '\n');
      return { next: 'halt', ctx };
    }

    prTitle = titleResult.stdout;
  }

  // Step 4: Push branch
  const pushResult = spawnCmd(
    'git', ['push', '-u', 'origin', branchName], logger, PhaseName.PR, spawnFn,
  );

  if (pushResult.exitCode !== 0) {
    const msg = PR_MESSAGES.pushFailed(branchName, pushResult.stderr);
    console.error(msg);
    logger.writePhaseLog(PhaseName.PR, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  // Step 5: Create PR via gh
  const ghResult = spawnCmd(
    'gh', ['pr', 'create', '--title', prTitle, '--body', prBody],
    logger, PhaseName.PR, spawnFn,
  );

  if (ghResult.exitCode !== 0) {
    const msg = PR_MESSAGES.ghPrFailed(ghResult.exitCode, ghResult.stderr);
    console.error(msg);
    logger.writePhaseLog(PhaseName.PR, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  const prUrl = ghResult.stdout;

  logger.appendRunJson({
    event: 'pr_finalize_complete',
    branchName,
    prTitle,
    prUrl,
    beadsClosed,
  });

  // Store PR URL on context for Phase 9 summary
  (ctx as OrchestratorContext & { prUrl?: string }).prUrl = prUrl;
  (ctx as OrchestratorContext & { beadsClosed?: string[] }).beadsClosed = beadsClosed;

  return { next: PhaseName.Report, ctx };
}
