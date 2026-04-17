---
name: bead-wave-orchestration
description: Wave lifecycle pattern for executing enriched beads in parallel under a hard 3-implementer cap. Use this skill when orchestrating an epic (or a multi-bead run) through spawn → per-bead audits → wave-end verification → build-guardian → cascade, when deciding how many implementers to spawn concurrently, when resolving implementer failures through retry versus escalation, or when running the epic-completion sweep after every wave has closed.
---

# Bead Wave Orchestration

This skill captures the **wave lifecycle** that drives epic (or multi-bead)
execution. It is the source of truth for how many implementers may run
concurrently, how per-bead audits cascade off each implementer's close, how
wave-end verification is sequenced, how failures are recovered, and how the
epic-completion sweep finalizes the run.

This is a prose-only skill. There are no scripts. Orchestration logic lives
in the consuming commands; this skill is what those commands reference so the
invariants below stay in exactly one place.

Consumers: `/spawn-bead-workers` (core mechanics), `/process-backlog` (when
the target is an epic, and for the single-leaf reduction of the same
pattern).

Depends on / cross-references:

- [`agent-discovery`](../agent-discovery/SKILL.md) — per-bead auditor
  matching (`match-agents.sh auditor`) and epic-completion discovery
  (`discover-agents.sh`).
- [`implementer-prompt-template`](../implementer-prompt-template/SKILL.md) —
  the canonical prompt every implementer in a wave receives, and the
  pre-close discipline (kill stale vitest, lint, targeted tests) the wave
  invariants rely on.
- [`bead-state-assessment`](../bead-state-assessment/SKILL.md) — the
  enrichment check the orchestrator runs before any implementer is spawned.
- [`bead-backlog-selection`](../bead-backlog-selection/SKILL.md) —
  escalation contract (`bd-escalate.sh`) used when retries exhaust.
- [`review-mode-auditor`](../review-mode-auditor/SKILL.md) — the PASS /
  PASS WITH WARNINGS / FAIL protocol every per-bead auditor follows.

## Hard rules (non-negotiable)

These invariants hold across every wave, every run, every consumer. Breaking
any of them corrupts the orchestration contract.

1. **Maximum 3 parallel implementers.** Never spawn a 4th implementer while
   three are still in flight. If more than 3 beads are ready, the extras
   queue and the orchestrator spawns them into slots as earlier implementers
   close.
2. **Per-bead auditors do NOT count against the 3-slot implementer budget.**
   Auditors are read-only code-analysis agents. They run in parallel with
   each other and in parallel with other waves' implementers as long as
   they only read committed / already-closed work. The 3-slot cap exists
   to contain write contention on the working tree and test/lint
   resources; auditors hit neither.
3. **Only spawn implementers for enriched beads.** Every bead dispatched to
   an implementer must have an `Implementation Context` block in its notes.
   The orchestrator checks this before spawn; the implementer re-checks as
   a belt-and-braces refusal (see `implementer-prompt-template`).
4. **Never more than one build-guardian at a time.** Test suites must not
   run concurrently. Exactly one build-guardian runs per wave, and it runs
   only after all implementers in that wave have closed and all per-bead
   auditors have reported.
5. **Kill stale vitest processes before any test run.** Every agent that
   runs tests — implementers in their pre-close checklist and the
   build-guardian at wave end — begins with:
   ```bash
   pkill -f "vitest" 2>/dev/null || true
   ```
   Zombie watcher processes from prior runs hold ports and cause
   mysterious hangs.
6. **Never run the full suite outside build-guardian.** Implementers run
   lint + targeted tests only. The full suite (lint → unit → integration →
   build → e2e) is the build-guardian's job, once per wave. This is how the
   "no concurrent test suites" invariant is enforced.
7. **Sequential wave-end verification chain.** The wave-end chain
   (cross-bead-integration-verifier → architecture-auditor →
   build-guardian) runs **in order, not in parallel**. Each step waits for
   the prior to report. Parallelizing this chain would let the
   build-guardian start while integration issues are still unresolved.

## Wave lifecycle

A wave is a set of ready, enriched beads that the orchestrator spawns
together, followed by the verification that proves the wave's combined
output is safe to build on top of. Each wave proceeds through these
stages in order.

### 1. Identify ready + enriched beads

Before spawning anything, the orchestrator:

1. Reads the ready set (`bd ready` for the epic's children, or the single
   bead for `/process-backlog` single-leaf Branch B).
2. For each candidate, runs `bead-state-assessment/bd-enrichment-check.sh`
   (exit 0 = enriched, exit 1 = missing Implementation Context).
3. Splits the candidates into **enriched** (ready to dispatch) and
   **unenriched** (must be enriched before dispatch).
4. For any unenriched bead, spawns a **general-purpose enrichment
   subagent** that populates the Implementation Context via the
   `/analyze-bead` Phase 4 flow, then re-checks. **Enrichment does NOT
   count against the 3-slot implementer budget** and **does NOT count as
   a retry against the bead's retry limit.** It is a precondition, not
   an attempt.

### 2. Spawn implementers (max 3 in parallel)

With only enriched beads in hand, the orchestrator dispatches implementers
using the canonical prompt from
[`implementer-prompt-template`](../implementer-prompt-template/SKILL.md):

1. If ≤ 3 enriched beads remain: spawn all in one parallel Task batch.
2. If > 3: spawn the first 3 (typically by bead priority / age), queue the
   remainder.
3. As each implementer closes (via `bd close`), pop from the queue and
   spawn the next, maintaining the 3-in-flight cap.

Each implementer independently runs its own pre-close checklist
(`pkill -f "vitest"`, `npm run lint`, `npx vitest run <file1> <file2>
--maxThreads=2`) and calls `bd close {bead_id}` only when lint and
targeted tests pass. If lint or targeted tests fail, the implementer does
not close; it reports back and the orchestrator routes to the failure
handling below.

### 3. Per-bead auditor cascade (as each implementer closes)

Each time an implementer closes its bead, the orchestrator immediately
spawns that bead's matched auditors:

1. Collect the changed file list for the bead (typically
   `git diff --name-only <merge-base>...HEAD` over that implementer's
   commit, or the bead's `Files to Modify` list if no commit lookup is
   available).
2. Pipe the file list into
   [`agent-discovery`](../agent-discovery/SKILL.md)'s
   `match-agents.sh auditor`. The script returns a JSON array of
   `{name, path, description, rationale}` for every auditor whose scope
   overlaps the changed files.
3. Spawn every matched auditor in a single parallel Task batch. If any
   auditor's description indicates it accepts a spec path, pass
   `Spec: {spec_path}` in the spawn prompt.
4. Auditors run concurrently with each other and concurrently with any
   in-flight implementers on *other* beads. They are read-only and do
   NOT count against the 3-slot implementer budget.
5. Wait for all matched auditors to report before considering this bead
   "wave-complete." Other beads' implementers continue unaffected.

Apply [`review-mode-auditor`](../review-mode-auditor/SKILL.md) verdicts:

| Verdict | Action |
|---|---|
| **PASS** | Bead is wave-complete; proceed. |
| **PASS WITH WARNINGS** | Record warnings in wave summary / PR body; do NOT block. |
| **FAIL** | Return findings to the implementer for a single retry round. If a second audit still FAILs, escalate per [`bead-backlog-selection`](../bead-backlog-selection/SKILL.md) via `bd-escalate.sh`. |

A wave is not ready for the wave-end chain until **every** bead in the
wave has closed and **every** matched per-bead auditor for those beads
has reported a resolved verdict (PASS or PASS WITH WARNINGS after any
required retry).

### 4. Wave-end verification chain (sequential, not parallel)

After all beads in the wave have closed and all per-bead auditors have
resolved, the orchestrator runs the following chain **in order**. Each
step must complete and pass before the next step starts. Never
parallelize this chain.

**Step A — cross-bead-integration-verifier** (conditional)

- Run **only if the wave size > 1.** A single-bead wave has nothing to
  cross-verify; skip this step.
- Spawn exactly one `cross-bead-integration-verifier` subagent.
- It looks for conflicts, duplications, and inconsistencies that
  per-bead auditors miss because each bead was verified in isolation.
- Verdict handling:
  - 🔴 Conflicts → spawn a follow-up implementer with the conflict
    details, re-run the affected per-bead auditors, then re-run this
    step. Do NOT proceed to Step B.
  - 🟡 Duplications / inconsistencies → address if a quick fix;
    otherwise note for end-of-epic cleanup and proceed.
  - 🟢 Clean → proceed to Step B.

**Step B — architecture-auditor (light pass)** (always)

- Spawn exactly one `architecture-auditor`, configured for a light
  pass (not a deep audit).
- It reads product docs (mission.md, decisions.md, roadmap.md), diffs
  the wave's changes, and flags vision drift, decision violations, and
  conceptual fragmentation.
- Verdict handling:
  - 🔴 HIGH (decision violation, vision misalignment) → resolve before
    proceeding. Spawn a follow-up implementer if needed.
  - 🟡 MEDIUM / LOW → note in the wave summary; address if quick.
  - 🟢 PASS → proceed to Step C.

**Step C — build-guardian** (always, exactly once per wave)

- **NEVER more than one build-guardian at a time.** Test suites must
  not run concurrently.
- Spawn exactly one `build-guardian` subagent. It runs the full
  sequential suite internally:
  ```
  pkill -f "vitest" 2>/dev/null || true
  npm run lint
  npx vitest run (unit)
  npx vitest run (integration)
  npm run build
  (e2e as applicable)
  ```
- Build-guardian is the single point where the full test suite runs
  for this wave's combined changes. The implementers' targeted tests
  proved each bead's local correctness; build-guardian proves the
  integrated wave still passes.
- Verdict handling:
  - 🟢 Pass → wave is complete; cascade to the next wave.
  - 🔴 Fail → see "Build-guardian failure" in failure handling below.

### 5. Cascade to the next wave

Once the wave-end chain is green:

1. Run `bd ready` (or equivalent for `/process-backlog`) to find newly
   unblocked beads.
2. Return to step 1 of this lifecycle for the next wave.
3. When no ready beads remain, proceed to the **Epic completion sweep**
   (see below).

## Failure handling

Failures can happen at any of four points: unenriched bead slipped past
the pre-spawn gate, implementer reports test failure, implementer reports
an implementation blocker, build-guardian fails at wave end. Each has a
distinct recovery protocol, and all share a common retry ceiling.

### Unenriched bead (implementer refused)

If an implementer runs `bd show {bead_id}` and reports
`"Bead {bead_id} is not enriched. Cannot implement without notes."`, the
pre-spawn enrichment check missed it. Recover:

1. Spawn a **general-purpose enrichment subagent** scoped to just that
   bead, following the `/analyze-bead` Phase 4 enrichment flow.
2. Wait for enrichment to complete. Verify via
   `bead-state-assessment/bd-enrichment-check.sh`.
3. Re-spawn the implementer with the same prompt.

**Enrichment-then-retry does NOT count toward the retry limit.** It is
recovering from a precondition failure, not retrying a failed attempt.

### Test failure (implementer reports targeted tests failing)

If an implementer cannot make its targeted tests pass:

1. Spawn a `test-failure-investigator` subagent with the failure context
   (test file paths, failure output, bead's Implementation Context).
2. The investigator diagnoses whether the test is wrong or the code is
   wrong (see `testing-test-validity` standards).
3. Based on the diagnosis, spawn a follow-up implementer to apply the fix
   (this counts as a retry — see retry limit below).

### Implementation blocker (implementer reports stuck)

If an implementer reports a non-test blocker (missing dependency,
ambiguous requirement, unexpected codebase state, scope creep beyond
`Files to Modify`):

1. Do NOT have the orchestrator try to fix it — the orchestrator is not
   an implementer.
2. Surface the blocker to the user with options:
   - Retry with an adjusted approach (counts as a retry).
   - Spawn a research subagent to investigate first.
   - Escalate via `bead-backlog-selection/bd-escalate.sh <id> <reason>`
     (adds `needs-human` label, appends Escalation section, bead is
     skipped on future autonomous runs).
   - Skip the bead and continue the wave without it (only valid if the
     bead does not block other ready beads).

### Build-guardian failure (wave-end)

If build-guardian fails:

1. Spawn `test-failure-investigator` with the build-guardian's report.
   The report includes `git log` output to help attribute failures to
   specific beads' commits.
2. Spawn a follow-up implementer for the responsible bead to fix the
   issue (counts as a retry for that bead).
3. Re-run the per-bead auditor cascade for the fixed bead.
4. Re-run the wave-end chain from the start of Step A (in case the fix
   introduced new integration issues, the integration verifier must see
   the updated state).
5. Only cascade to the next wave once build-guardian reports green.

### Retry limit

- **Maximum 2 retries per bead in wave contexts.**
- Enrichment-then-retry is NOT a retry.
- A "retry" is a fresh implementer spawn after a failed implementation
  attempt (test failure, blocker fix, build-guardian attribution). Each
  retry should include learnings from the previous attempt in the
  spawning context.
- After 2 retries still fail, escalate per
  [`bead-backlog-selection`](../bead-backlog-selection/SKILL.md):
  call `bd-escalate.sh <id> "<reason>"`, preserve the branch, exit
  cleanly from `/process-backlog` runs (the bead is labelled
  `needs-human` and will be skipped on future autonomous runs; a human
  removes the label to re-queue).

**Single-leaf exception (`/process-backlog` Branch B):** When
`/process-backlog` executes a leaf bead directly (not as part of an
epic wave), the retry ceiling is **1** instead of 2. Rationale:
Branch B is the autonomous-single-bead path where a failing implementer
is almost always a signal that the bead itself needs human attention
(shape issue, missing context, environmental assumption), not something
a second mechanical retry will fix. The tighter ceiling reaches
escalation faster and keeps the autonomous loop from burning context
on beads that cannot self-recover. Epic waves keep the 2-retry ceiling
because a single bead failure within a multi-bead wave is more often a
transient integration issue worth one more attempt.

## Epic completion sweep

Once every wave has closed — no ready beads remain, every wave's
build-guardian has passed, every bead is closed — the orchestrator runs
a final comprehensive sweep before declaring the epic done.

1. **Discover applicable comprehensive agents** via
   [`agent-discovery`](../agent-discovery/SKILL.md):
   - `discover-agents.sh reviewer` — all `*-reviewer` agents (e.g.
     `frontend-standards-reviewer`).
   - `discover-agents.sh auditor` — all `*-auditor` agents whose
     descriptions indicate comprehensive / final-pass scope.
   - `discover-agents.sh verifier` — all `*-verifier` agents.
2. **Filter matches** against the epic's full changed file set (union of
   all waves' changes: `git diff --name-only main...HEAD`).
3. **Always include `implementation-verifier`** if present, regardless
   of match. It performs the full spec verification pass (lint, full
   test suite, e2e, acceptance criteria check against the spec). If it
   is absent, log the absence in the wave summary — do not substitute a
   different agent.
4. **Spawn matched agents in parallel** (they are read-only, so
   concurrency is unbounded by the 3-slot rule). When an agent's
   description accepts a spec path, pass `Spec: {spec_path}` in the
   spawning prompt.
5. **Collect verdicts.** PASS / PASS WITH WARNINGS surface in the final
   report; FAIL blocks closing the epic. For a FAIL at this stage, route
   through the same failure-handling flow as build-guardian failure
   (investigator → implementer → rerun the wave-end chain for the
   affected wave, then redo the sweep).
6. **Close the epic** via `bd close <epic-id>` once all comprehensive
   agents report resolved verdicts.

## Single-leaf reduction

When `/process-backlog` targets a single leaf bead (not an epic), the
same lifecycle applies in its reduced form:

- One wave. One bead. One implementer.
- The per-bead auditor cascade still runs after the implementer closes.
- The wave-end chain runs with:
  - `cross-bead-integration-verifier` **skipped** (wave size is 1).
  - `architecture-auditor` light pass runs (always).
  - `build-guardian` runs once (always).
- The epic completion sweep collapses to the same build-guardian pass
  plus the `implementation-verifier` invocation (which is effectively
  the "wave" and "epic" stages merging, since the whole run is one
  bead). Comprehensive reviewers matched to the changed files still
  run.

The implementer prompt, refusal protocol, pre-close checklist, kill-vitest
step, and retry limits are all identical to the epic-wave variant. See
[`implementer-prompt-template`](../implementer-prompt-template/SKILL.md)
for the shared contract.

## Evolution and source of truth

Before this skill existed, the wave lifecycle was inlined in
`.claude/commands/spawn-bead-workers.md` Phases 3-6 (lines ~120-350).
Consumers should reference this skill by name instead of re-inlining the
mechanics. Any behavioral change — new verification step, different
retry semantics, changes to the 3-implementer cap, adjustments to the
wave-end chain ordering — should be made **here first**, then
propagated to consumers. Divergence between this skill and a consumer
is a bug; the skill is authoritative.
