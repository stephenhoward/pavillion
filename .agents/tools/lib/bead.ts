/**
 * Deterministic bead escalation for agent orchestration.
 *
 * DEFERRED: `escalate` is the one bead CLI with no single owning skill — it
 * is called by agent-discovery, epic-bead-workflow, bead-wave-orchestration,
 * implementer-prompt-template, /clear-backlog and /spawn-bead-workers. The
 * state/sizing/enrichment classifiers moved to
 * .agents/skills/bead-state-assessment/scripts/ and agent enumeration to
 * .agents/skills/agent-discovery/scripts/; finding this one a home is the
 * remaining cleanup.
 */

import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { run, type SpawnDeps } from './shared.js';

// =============================================================================
// bdEscalate
// =============================================================================

/**
 * Mark a bead as needs-human and append an escalation note.
 *
 * Idempotent — if today's escalation block is already present in the notes,
 * skips the append but still adds the label (bd's label store is a set).
 */
export function bdEscalate(
  beadId: string,
  reason: string,
  phase: string,
  deps: SpawnDeps = {},
): void {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const today = new Date().toISOString().split('T')[0];

  // Add label (set-based; idempotent)
  run('bd', ['label', 'add', beadId, 'needs-human'], spawn);

  // Check existing notes
  const showResult = run('bd', ['show', beadId, '--json'], spawn);
  let notes = '';
  if (showResult.exitCode === 0 && showResult.stdout) {
    try {
      const parsed = JSON.parse(showResult.stdout) as Array<{ notes?: string }>;
      notes = parsed[0]?.notes ?? '';
    }
    catch {
      // ignore
    }
  }

  // Idempotency: skip if today's section already present
  if (notes.includes(`## Escalation (${today})`)) {
    return;
  }

  const escBlock = `\n## Escalation (${today})\n\nPhase: ${phase}\nReason: ${reason}\n`;
  run('bd', ['update', beadId, '--append-notes', escBlock], spawn);
}

