# Bead Worker Orchestration

Spawn parallel subagents for dependency-ready beads with full enriched context.

## Critical Rules

- **Maximum 3 parallel implementers** — HARD LIMIT. Never spawn a 4th implementer while three are still in flight. If more than 3 beads are ready, queue the extras and spawn them as slots free up. Auditors/verifiers are read-only and do NOT count against this cap.
- **Only spawn implementers for enriched beads** — every bead must have an `Implementation Context` block in its notes before dispatch.
- **Never more than one build-guardian at a time** — one per wave, sequential, after all beads and per-bead auditors resolve.

## Skill dependencies (source of truth — do NOT re-inline)

This command orchestrates around three skills that hold the authoritative prose. Reference them; never duplicate their content here.

- [`bead-wave-orchestration`](../skills/bead-wave-orchestration/SKILL.md) — wave lifecycle: the 3-implementer cap, per-bead auditor cascade, wave-end verification chain (cross-bead-integration-verifier → architecture-auditor → build-guardian), failure handling, retry rules, epic completion sweep.
- [`implementer-prompt-template`](../skills/implementer-prompt-template/SKILL.md) — canonical implementer subagent prompt: bead-first read, refusal protocol for unenriched beads, TDD, pre-close checklist (kill vitest, lint, targeted tests, `bd close`).
- [`agent-discovery`](../skills/agent-discovery/SKILL.md) — dynamic discovery and selection of auditor/verifier agents. Enumerate candidates with `npx tsx .claude/tools/bead.ts agents {auditor,verifier}`; the orchestrating agent selects the applicable subset per the skill's guidance.

## Overview

1. Read the epic structure and implementation context from bead notes (populated by `/analyze-bead`).
2. Confirm ready beads are enriched; enrich any that aren't before spawning implementers.
3. Spawn implementers (max 3 parallel) per `implementer-prompt-template`; cascade per-bead auditors via `agent-discovery` as each closes.
4. Run the sequential wave-end chain; run ONE build-guardian per wave.
5. Cascade to the next wave; repeat until no ready beads remain; run the epic-completion sweep.

## Prerequisites

- Epic has been analyzed: epic notes contain structure overview and leaf beads contain implementation context.
- OR: Run `/analyze-bead <epic-id>` first to populate bead notes.
- Load the `epic-bead-workflow` skill.

## Process

### PHASE 1: Load Epic Analysis

IF an epic ID is provided:
1. Load the epic: `bd show <epic-id>`.
2. Check that notes contain an "Epic Analysis" section.
3. If missing, offer to run `/analyze-bead` first.

IF no epic ID provided:
1. List open epics: `bd list --status=open --type=epic`.
2. Ask which epic to orchestrate.

### PHASE 2: Confirm Ready Beads (Initial Enrichment Gate)

```bash
bd show <epic-id>   # hierarchy
bd ready            # unblocked beads
```

For each ready leaf bead, run `bd show <bead-id>` and sort into **enriched** (notes contain `Implementation Context`) vs. **unenriched** (missing). The deterministic check is `npx tsx .claude/tools/bead.ts enrichment-check <bead-id>` — exit 0 means enriched, exit 1 means not.

**Enrichment gate (REFUSE to start if any targeted bead lacks Implementation Context).** If any ready or user-selected bead is unenriched:

1. Report the list of unenriched beads to the user.
2. Spawn a **general-purpose enrichment subagent** that populates notes following `/analyze-bead` Phase 4. Enrichment does NOT count against the 3-implementer cap and does NOT count as a retry (see `bead-wave-orchestration`).
3. Wait for enrichment to complete. Re-run the enrichment check. Do NOT spawn implementers until every targeted bead is enriched.

Display the enriched, ready beads and let the user proceed, select a subset, or adjust.

### PHASE 3: Spawn Implementers

**Reference:** [`bead-wave-orchestration`](../skills/bead-wave-orchestration/SKILL.md) "Wave lifecycle → 2. Spawn implementers" for the full cap/queue semantics; [`implementer-prompt-template`](../skills/implementer-prompt-template/SKILL.md) for the canonical prompt the Task tool must render (verbatim — do not paraphrase) when dispatching each implementer.

Spawning rules (invariants):

- If ≤ 3 enriched beads remain: spawn all in one parallel Task batch.
- If > 3: spawn the first 3, queue the remainder; pop into slots as earlier implementers close. **HARD LIMIT: 3 parallel implementers.**
- Never spawn an implementer for an unenriched bead (the refusal protocol in the template is a belt-and-braces backstop; the Phase 2 gate is the primary enforcement).

### PHASE 4: Monitor & Per-Bead Audits

**Reference:** [`bead-wave-orchestration`](../skills/bead-wave-orchestration/SKILL.md) "Wave lifecycle → 3. Per-bead auditor cascade".

As each implementer closes (via `bd close`):

1. Collect the bead's changed file list (typically `git diff --name-only` over the implementer's commit, falling back to the bead's `Files to Modify`).
2. Enumerate candidates with `npx tsx .claude/tools/bead.ts agents auditor` and select the applicable subset yourself by matching the changed files against each candidate's description (per [`agent-discovery`](../skills/agent-discovery/SKILL.md); default toward inclusion). The enumeration tool is the ONLY source of candidates — do not maintain a hardcoded list.
3. Spawn every matched auditor in a single parallel Task batch. If an auditor's description accepts a spec path, pass `Spec: {spec_path}`.
4. Auditors are read-only and run concurrently with other implementers and each other; they do NOT count against the 3-slot implementer budget.
5. Apply auditor verdicts per [`review-mode-auditor`](../skills/review-mode-auditor/SKILL.md): PASS proceeds; PASS WITH WARNINGS is recorded in the wave summary; FAIL returns findings to the implementer for a single retry round.

### PHASE 5: Handle Failures

**Reference:** [`bead-wave-orchestration`](../skills/bead-wave-orchestration/SKILL.md) "Failure handling" for the full recovery protocols. Invariants this command preserves:

- **Unenriched-bead refusal from implementer** — spawn a general-purpose enrichment subagent scoped to just that bead, then re-spawn. Enrichment-then-retry does NOT count toward the retry limit.
- **Test failure** — spawn `test-failure-investigator` with failure context; route to a follow-up implementer based on its diagnosis (counts as a retry).
- **Implementation blocker** — surface to user: retry with adjusted approach, spawn research subagent, escalate via `npx tsx .claude/tools/bead.ts escalate <id> "<reason>"`, or skip if it doesn't block other work.
- **Retry limit: maximum 2 per bead.** Enrichment recovery does NOT count. After 2 retries still fail, escalate via the escalate tool and exit.

### PHASE 6: Wave-End Verification Chain & Cascade

**Reference:** [`bead-wave-orchestration`](../skills/bead-wave-orchestration/SKILL.md) "Wave lifecycle → 4. Wave-end verification chain".

After all beads in the wave have closed AND all per-bead auditors have resolved, run the following chain **sequentially, not in parallel** (each step waits for the prior):

1. **`cross-bead-integration-verifier`** — spawn ONLY IF wave size > 1. Catches conflicts, duplications, and inconsistencies that per-bead auditors miss because beads were verified in isolation. Skipped for single-bead waves.
2. **`architecture-auditor`** (light pass) — always, exactly one. Reads product docs, diffs wave changes, flags vision drift / decision violations / conceptual fragmentation.
3. **`build-guardian`** — always, exactly ONCE per wave. Runs the full sequential suite (lint → unit → integration → build → e2e). **NEVER more than one build-guardian at a time** — test suites must not run concurrently.

Build-guardian failure handling: spawn `test-failure-investigator` (its report includes `git log` output for attribution); spawn a follow-up implementer on the responsible bead (counts as a retry); re-run per-bead auditors for the fixed bead; re-run the wave-end chain from Step 1. Only cascade to the next wave once build-guardian reports green.

When the chain is green, run `bd ready` to find newly-unblocked beads. Each newly-ready bead is put back through Phase 2's enrichment gate (a bead added after `/analyze-bead` ran may still need enrichment). Then repeat Phases 3-6 for the next wave until no ready beads remain.

### PHASE 7: Epic Completion Sweep

**Reference:** [`bead-wave-orchestration`](../skills/bead-wave-orchestration/SKILL.md) "Epic completion sweep".

When every wave has closed and every bead is complete:

1. Verify epic status: `bd show <epic-id>`.
2. Discover comprehensive agents via `agent-discovery`:
   ```bash
   npx tsx .claude/tools/bead.ts agents auditor
   npx tsx .claude/tools/bead.ts agents verifier
   ```
3. Filter matches against the epic's full changed file set (union across waves: `git diff --name-only main...HEAD`).
4. Always include `implementation-verifier` if present (full spec verification: lint, full suite, e2e, acceptance criteria). If absent, log the absence; do not substitute a different agent.
5. Spawn matched agents in parallel (read-only; unbounded by the 3-slot rule). Pass `Spec: {spec_path}` when an agent's description accepts one.
6. Collect verdicts. PASS / PASS WITH WARNINGS surface in the final report; FAIL blocks closing the epic and routes through build-guardian-style failure handling (investigator → implementer → re-run the affected wave's end-chain → redo the sweep).
7. Close the epic: `bd close <epic-id>`.
8. Emit the completion report (beads completed, verification results, files changed, readiness for PR/merge).

## Orchestration Options

### Selective Spawning

```
/spawn-bead-workers <epic-id> --only <bead-id>[,<bead-id>...]
```

Only the listed beads are targeted this run. The Phase 2 enrichment gate still applies to each selected bead.

### Sequential Mode

```
/spawn-bead-workers <epic-id> --sequential
```

One bead at a time, waiting for user approval between each. Useful for debugging. The wave-end chain (architecture-auditor + build-guardian) still runs between steps because every "wave" is a single-bead wave.

### Dry Run

```
/spawn-bead-workers <epic-id> --dry-run
```

Report the wave plan, enrichment status of each targeted bead, and the auditors you would select per bead (from the `agents auditor` candidate list). Make zero changes.

### Resume

```
/spawn-bead-workers <epic-id> --resume
```

If a prior run was interrupted:
1. Check which beads are already closed.
2. Identify any in-progress beads (may need cleanup).
3. Re-run the Phase 2 enrichment gate on the remaining ready beads.
4. Resume from the current wave state, reusing the standard Phase 3-6 flow.

## Acceptance / Manual Verification

This command has no automated tests. To verify behavioral equivalence with the pre-refactor version (or after any future edit):

1. Read the command end-to-end and confirm the 7 behavior-preservation invariants are explicitly stated (or referenced via the three skills):
   - Max 3 parallel implementers (HARD LIMIT).
   - Per-bead auditor cascade sourced from the `agent-discovery` selection process (candidates from `bead.ts agents auditor`).
   - `cross-bead-integration-verifier` triggered only when wave size > 1.
   - `build-guardian` gate: once per wave, sequential, after all beads + audits resolve.
   - Retry limit: max 2 per bead; enrichment recovery doesn't count.
   - `test-failure-investigator` spawned on test/build failures.
   - Unenriched-bead refusal from implementers (template-side) + Phase 2 enrichment gate (orchestrator-side).
2. Invoke `/spawn-bead-workers` on a known-good analyzed epic. Compare the wave structure, audit cascade, and build-guardian gate to the pre-refactor run — they must be identical. Any divergence is a bug; fix the skill (authoritative) before the command.

## Integration with Build Guardian (summary)

Test execution is centralized at the wave level to prevent concurrent vitest instances. Implementers run `npm run lint` + targeted tests (bead-listed files only) pre-close; the full suite runs exactly once per wave via the single `build-guardian` invocation at the end of the wave-end chain. Any agent that runs tests must first kill stale vitest processes:

```bash
pkill -f "vitest" 2>/dev/null || true
```

All `*-auditor` agents are purely read-only — they run in parallel with each other and with in-flight implementers without contending for test resources. Full rationale and sequencing lives in [`bead-wave-orchestration`](../skills/bead-wave-orchestration/SKILL.md).
