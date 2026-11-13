# Bead Worker Orchestration

Run an epic's enriched beads as dependency chains of stacked branches, up to three chains at a time, with full enriched context.

## Critical Rules

- **Maximum 3 chains in flight** — HARD LIMIT. The cap counts dependency chains, not beads: a chain holds one implementer slot for its whole run and its beads run one after another. Never start a 4th chain while three are in flight; extra chains queue for the next free slot. Auditors/verifiers are read-only and do NOT count against this cap.
- **Only spawn implementers for enriched beads** — every bead must have an `Implementation Context` block in its notes before dispatch.
- **Never more than one build-guardian at a time** — one per stack level, on that level's branch, before that level is submitted.

## Skill dependencies (source of truth — do NOT re-inline)

This command orchestrates around the skills below, which hold the authoritative prose. Reference them; never duplicate their content here.

- [`bead-wave-orchestration`](../skills/bead-wave-orchestration/SKILL.md) — the chain/level lifecycle: the 3-chain cap, per-bead auditor cascade, per-level build gate before submit, advisory chain-end verification pass, failure handling and chain truncation, retry rules, resuming an interrupted run, and the blocking epic-completion sweep.
- [`bead-branch-and-pr`](../skills/bead-branch-and-pr/SKILL.md) — the executable chain and stack operations: `npx tsx .agents/skills/bead-branch-and-pr/scripts/stack.ts {plan,create,submit,sync}`.
- [`git-workflow`](../skills/git-workflow/SKILL.md) — stacking conventions in [`stacking.md`](../skills/git-workflow/stacking.md): PR shape, the merge ritual, worktree mode, `gh stack checkout`.
- [`implementer-prompt-template`](../skills/implementer-prompt-template/SKILL.md) — canonical implementer subagent prompt: bead-first read, refusal protocol for unenriched beads, TDD, pre-close checklist (leave other test runs alone, lint, targeted tests, `bd close`).
- [`agent-discovery`](../skills/agent-discovery/SKILL.md) — dynamic discovery and selection of auditor/verifier agents. Enumerate candidates with `npx tsx .agents/skills/agent-discovery/scripts/agents.ts {auditor,verifier}`; the orchestrating agent selects the applicable subset per the skill's guidance.

## Overview

1. Read the epic structure and implementation context from bead notes (populated by `/analyze-bead`).
2. Confirm ready beads are enriched; enrich any that aren't before spawning implementers.
3. Plan the epic's dependency chains and run up to 3 at a time, one stack level per bead, dispatching implementers per `implementer-prompt-template`; cascade per-bead auditors via `agent-discovery` as each bead closes.
4. Gate each stack level with its own build-guardian, then submit it; run the advisory chain-end verification pass once a chain's levels are done.
5. Cascade to the next wave of chains until no remaining chain has a ready head; run the blocking epic-completion sweep.

## Prerequisites

- Epic has been analyzed: epic notes contain structure overview and leaf beads contain implementation context.
- OR: Run `/analyze-bead <epic-id>` first to populate bead notes.
- Load the `epic-bead-workflow` skill.

## Process

### PHASE 1: Load the Epic

IF an epic ID is provided:
1. Load the epic: `bd show <epic-id>`. If it carries `spec:building`, refuse and stop: say that the root carries `spec:building`, so the scheduled build (`--scheduled`) holds it and resumes it itself. The maintainer releases it by moving the label, not by running it attended.
2. Check that notes contain a "Bead Analysis" section (the `# Bead Analysis` heading `/analyze-bead` writes).
3. If missing, offer to run `/analyze-bead` first.
4. If the epic carries the `spec:ready` label (set by `/plan --scheduled` when it finishes a root), release it before any implementer is dispatched:
   ```bash
   bd update <epic-id> --remove-label spec:ready
   ```
   `/clear-backlog` skips every bead whose parent carries a `spec:*` label, which holds an un-started epic together as one run. Once this run starts the hold has done its job; releasing it means any leaf still open after the run sits under a root with no `spec:*` label, so the backlog sweep picks it up through normal tiering. Releasing the label does not release the epic's `decision`-type `Decide:` leaves: they stay with the maintainer and are never dispatched (Phase 2).

IF no epic ID provided:
1. List open epics: `bd list --status=open --type=epic`.
2. Ask which epic to orchestrate.

### PHASE 2: Confirm Ready Beads (Initial Enrichment Gate)

```bash
bd show <epic-id>   # hierarchy
bd ready --exclude-type decision   # unblocked beads, minus Decide: leaves
```

`bd ready` lists `decision`-type beads by default. A `Decide:` leaf (from `/plan --scheduled`) awaits the maintainer's ruling and gates its dependents; never enrich it or dispatch an implementer on it, even when it is ready or named in `--only`. Leaves it blocks become ready only once the maintainer closes it.

For each ready leaf bead, run `bd show <bead-id>` and sort into **enriched** (notes have an `Implementation Context` heading) vs. **unenriched** (missing). The deterministic check is `npx tsx .agents/skills/bead-state-assessment/scripts/bead.ts enrichment-check <bead-id>` — exit 0 means enriched, exit 1 means not.

**Enrichment gate (REFUSE to start if any targeted bead lacks Implementation Context).** If any ready or user-selected bead is unenriched:

1. Report the list of unenriched beads to the user.
2. Spawn a **general-purpose enrichment subagent** that populates notes following `/analyze-bead` Phase 4. Enrichment does NOT count against the 3-chain cap and does NOT count as a retry (see `bead-wave-orchestration`).
3. Wait for enrichment to complete. Re-run the enrichment check. Do NOT spawn implementers until every targeted bead is enriched.

Display the enriched, ready beads and let the user proceed, select a subset, or adjust.

### PHASE 3: Run Chains

**Reference:** [`bead-wave-orchestration`](../skills/bead-wave-orchestration/SKILL.md) "Wave lifecycle → 1. Identify ready + enriched chains" and "2. Run chains" for chain planning, scheduling and the concurrency model; [`implementer-prompt-template`](../skills/implementer-prompt-template/SKILL.md) for the canonical prompt the Task tool must render (verbatim — do not paraphrase) when dispatching each implementer.

Invariants this command preserves:

- Chains come from `stack.ts plan` over the epic's full child set, planned once per epic; a wave schedules the chains whose head bead is ready. Mid-chain beads belong to their chain and are never scheduled on their own.
- **HARD LIMIT: 3 chains in flight.** The first chain of a wave runs in this checkout; each additional concurrent chain runs in its own git worktree, with its agents dispatched there.
- Each bead is one stack level, created with `stack.ts create` on its predecessor's branch; a chain's next level starts only after the previous level is submitted (Phase 6).
- Never spawn an implementer for an unenriched bead (the refusal protocol in the template is a belt-and-braces backstop; the Phase 2 gate is the primary enforcement).

### PHASE 4: Monitor & Per-Bead Audits

**Reference:** [`bead-wave-orchestration`](../skills/bead-wave-orchestration/SKILL.md) "Wave lifecycle → 3. Per-bead auditor cascade".

As each implementer closes (via `bd close`):

1. Collect the bead's changed file list (typically `git diff --name-only` over the implementer's commit, falling back to the bead's `Files to Modify`).
2. Enumerate candidates with `npx tsx .agents/skills/agent-discovery/scripts/agents.ts auditor` and select the applicable subset yourself by matching the changed files against each candidate's description (per [`agent-discovery`](../skills/agent-discovery/SKILL.md); default toward inclusion). The enumeration tool is the ONLY source of candidates — do not maintain a hardcoded list.
3. Spawn every matched auditor in a single parallel Task batch. If an auditor's description accepts a spec path, pass `Spec: {spec_path}`.
4. Auditors are read-only and run concurrently with other chains' implementers and each other; they do NOT count against the 3-chain cap.
5. Apply auditor verdicts per [`review-mode-auditor`](../skills/review-mode-auditor/SKILL.md): PASS proceeds; PASS WITH WARNINGS is recorded in the wave summary; FAIL returns findings to the implementer for a single retry round.

The bead's stack level is ready for its build gate once the bead has closed and every matched auditor has reported a resolved verdict.

### PHASE 5: Handle Failures

**Reference:** [`bead-wave-orchestration`](../skills/bead-wave-orchestration/SKILL.md) "Failure handling" for the full recovery protocols. Invariants this command preserves:

- **Unenriched-bead refusal from implementer** — spawn a general-purpose enrichment subagent scoped to just that bead, then re-spawn. Enrichment-then-retry does NOT count toward the retry limit.
- **Test failure** — spawn `test-failure-investigator` with failure context; route to a follow-up implementer based on its diagnosis (counts as a retry).
- **Implementation blocker** — surface to user: retry with adjusted approach, spawn research subagent, escalate via `npx tsx .agents/tools/bead.ts escalate <id> "<reason>"`, or skip if it doesn't block other work.
- **Build-guardian failure** — handled at the level that failed; see Phase 6.
- **Retry limit: maximum 2 per bead.** Enrichment recovery does NOT count. After 2 retries still fail, escalate via the escalate tool, preserve the branch, and stop that chain at the failed level (chain truncation). Other chains continue.

### PHASE 6: Per-Level Build Gate, Submit & Cascade

**Reference:** [`bead-wave-orchestration`](../skills/bead-wave-orchestration/SKILL.md) "Wave lifecycle → 4. Per-level build gate + per-chain verification" and "5. Cascade to the next wave"; [`stacking.md`](../skills/git-workflow/stacking.md) "PR shape".

For each stack level, once it is ready for its build gate (Phase 4):

1. **`build-guardian`** — exactly one, on that level's branch at its stack position. **NEVER more than one build-guardian at a time** — test suites must not run concurrently.
2. **Red** — follow the skill's "Build-guardian failure (per-level gate)": the level is not submitted while red, and exhausted retries truncate the chain at that level.
3. **Green** — submit the level with `stack.ts submit`, then set its title and body with `gh pr edit` per "PR shape". The chain's next level starts on top of it. `stack.ts submit` runs `gh stack submit --auto --open`: per `gh stack submit --help` (gh-stack 0.0.8), `--auto` only skips the interactive editor and takes auto-generated titles, and `--open` marks the PRs ready for review. Neither merges a PR or turns on auto-merge.

When a chain's levels are complete, run the chain-end verification pass from the skill, in order: `cross-bead-integration-verifier` only if the chain has more than one bead, then `architecture-auditor`. The pass is **advisory** — its levels are already submitted, so findings go to a follow-up implementer or the wave summary rather than holding anything back. The blocking check is the Phase 7 sweep.

When every chain in the wave has finished, run `bd ready --parent <epic-id> --exclude-type decision` to find newly-ready chain heads. Each is put back through Phase 2's enrichment gate (a bead added after `/analyze-bead` ran may still need enrichment). Then repeat Phases 3-6 for the next wave until no remaining chain has a ready head.

### PHASE 7: Epic Completion Sweep

**Reference:** [`bead-wave-orchestration`](../skills/bead-wave-orchestration/SKILL.md) "Epic completion sweep". This sweep is the run's blocking check.

When every wave has closed and every bead is complete:

1. Verify epic status: `bd show <epic-id>`.
2. Discover comprehensive agents via `agent-discovery`:
   ```bash
   npx tsx .agents/skills/agent-discovery/scripts/agents.ts auditor
   npx tsx .agents/skills/agent-discovery/scripts/agents.ts verifier
   ```
3. Filter matches against the epic's full changed file set (union across waves: `git diff --name-only main...HEAD`).
4. Always include `implementation-verifier` if present (full spec verification: lint, full suite, e2e, acceptance criteria). If absent, log the absence; do not substitute a different agent.
5. Spawn matched agents in parallel (read-only; unbounded by the 3-chain cap). Pass `Spec: {spec_path}` when an agent's description accepts one.
6. Collect verdicts. PASS / PASS WITH WARNINGS surface in the final report; FAIL blocks closing the epic and routes through build-guardian-style failure handling (investigator → implementer → rerun the affected level's build gate → redo the sweep).
7. Close the epic: `bd close <epic-id>`.
8. Emit the completion report: beads completed, the PR submitted for each stack level, verification results (including advisory chain-end findings), files changed, and any escalated beads or truncated chains. Merging is the maintainer's bottom-up ritual ([`stacking.md`](../skills/git-workflow/stacking.md) "Merge ritual"); this command never merges.

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

One bead (one stack level) at a time, waiting for user approval between each. Useful for debugging. Each level's build gate still runs before its submit, and each chain's chain-end pass still runs when its levels are done.

### Dry Run

```
/spawn-bead-workers <epic-id> --dry-run
```

Report the chain plan from `stack.ts plan`, enrichment status of each targeted bead, and the auditors you would select per bead (from the `agents auditor` candidate list). Make zero changes: if the epic carries `spec:ready`, report that a real run would remove it in Phase 1 rather than removing it.

### Resume

```
/spawn-bead-workers <epic-id> --resume
```

If a prior run was interrupted:
1. Check which beads are already closed.
2. Identify any in-progress beads (may need cleanup).
3. Recover each chain's levels per [`bead-wave-orchestration`](../skills/bead-wave-orchestration/SKILL.md) "Resuming an interrupted run": a submitted level comes back with `gh stack checkout <pr-number>` (catching up with `stack.ts sync` first if a lower level merged); a level with no submitted PR is redone from its bead.
4. Re-run the Phase 2 enrichment gate on the remaining ready beads.
5. Resume from the current wave state, reusing the standard Phase 3-6 flow.

An interrupted scheduled run needs no `--resume`: the next `--scheduled` firing resumes its `spec:building` root from the root's last Build state block ([`build-scheduled`](../skills/build-scheduled/SKILL.md) "Resume"), and Phase 1 refuses that root attended.

### Scheduled

```
/spawn-bead-workers --scheduled
/spawn-bead-workers --scheduled --dry-run
```

See "Scheduled mode" below.

## Scheduled mode (`--scheduled`)

Unattended run: no questions, at most one root per run, a report file per
run. The whole mode is the
[`build-scheduled`](../skills/build-scheduled/SKILL.md) skill. Load it and
follow it; the phases above apply only as its Overrides list says.
`--scheduled --dry-run` prints what a run would read and write, and changes
nothing.

## Acceptance / Manual Verification

This command has no automated tests. After any edit to it:

1. Read the command end-to-end and confirm these behavior-preservation invariants are explicitly stated (or referenced via the skills above):
   - Max 3 chains in flight (HARD LIMIT); a chain holds one slot for its whole run.
   - Per-bead auditor cascade sourced from the `agent-discovery` selection process (candidates from `agents.ts auditor`).
   - `build-guardian` gate: once per stack level, on that level's branch, before that level's submit; never more than one at a time.
   - Chain-end pass: `cross-bead-integration-verifier` only when the chain has more than one bead, then `architecture-auditor`; advisory.
   - Epic-completion sweep is the blocking check; a FAIL blocks closing the epic.
   - Retry limit: max 2 per bead; enrichment recovery doesn't count; exhausted retries truncate the chain.
   - `test-failure-investigator` spawned on test/build failures.
   - Unenriched-bead refusal from implementers (template-side) + Phase 2 enrichment gate (orchestrator-side).
2. Invoke `/spawn-bead-workers` on a known-good analyzed epic. Compare the chain plan, audit cascade, per-level build gates and submitted levels to what [`bead-wave-orchestration`](../skills/bead-wave-orchestration/SKILL.md) prescribes. Any divergence is a bug; fix the skill (authoritative) before the command.

## Integration with Build Guardian (summary)

Test execution is centralized per stack level to prevent concurrent vitest instances. Implementers run `npm run lint` + targeted tests (bead-listed files only) pre-close; the full suite runs exactly once per stack level, via that level's single `build-guardian` invocation before it is submitted. No agent kills vitest processes machine-wide (`pkill -f "vitest"` would kill other agents' runs); `vitest run` exits on its own.

All `*-auditor` agents are purely read-only — they run in parallel with each other and with in-flight implementers without contending for test resources. Full rationale and sequencing lives in [`bead-wave-orchestration`](../skills/bead-wave-orchestration/SKILL.md).
