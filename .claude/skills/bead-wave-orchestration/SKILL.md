---
name: bead-wave-orchestration
description: Wave lifecycle pattern for executing enriched beads as dependency chains under a hard 3-chain cap. Use this skill when orchestrating an epic (or a multi-bead run) through chain scheduling → per-bead audits → per-level build gate → submit → cascade, when deciding how many chains to run concurrently, when resolving implementer failures through retry versus chain truncation, or when running the epic-completion sweep after every wave has closed.
---

# Bead Wave Orchestration

This skill captures the **wave lifecycle** that drives epic (or multi-bead)
execution. It is the source of truth for how many chains may run
concurrently, how per-bead audits cascade off each implementer's close, how
per-level build gates and chain verification are sequenced, how failures
are recovered, and how the epic-completion sweep finalizes the run.

This is a prose-only skill. There are no scripts. Orchestration logic lives
in the consuming commands; this skill is what those commands reference so the
invariants below stay in exactly one place.

Consumers: `/spawn-bead-workers` (core mechanics), plus any future command
that executes an epic or multi-bead run (the single-leaf reduction of the
same pattern applies to lone leaf beads).

Depends on / cross-references:

- [`agent-discovery`](../agent-discovery/SKILL.md) — per-bead auditor
  selection and epic-completion discovery (candidates enumerated via
  `npx tsx .claude/tools/bead.ts agents <role>`).
- [`implementer-prompt-template`](../implementer-prompt-template/SKILL.md) —
  the canonical prompt every implementer in a wave receives, and the
  pre-close discipline (kill stale vitest, lint, targeted tests) the wave
  invariants rely on.
- [`bead-state-assessment`](../bead-state-assessment/SKILL.md) — the
  enrichment check the orchestrator runs before any implementer is spawned.
- [`epic-bead-workflow`](../epic-bead-workflow/SKILL.md) — the needs-human
  escalation protocol (`npx tsx .claude/tools/bead.ts escalate`) used when
  retries exhaust.
- [`review-mode-auditor`](../review-mode-auditor/SKILL.md) — the PASS /
  PASS WITH WARNINGS / FAIL protocol every per-bead auditor follows.

## Hard rules (non-negotiable)

These invariants hold across every wave, every run, every consumer. Breaking
any of them corrupts the orchestration contract.

1. **Maximum 3 parallel implementers — and the cap applies to CHAINS.**
   Waves are built from dependency chains (`npx tsx .claude/tools/stack.ts
   plan`), not individual beads. Within a
   chain, beads run strictly sequentially (each level's branch stacks on
   its predecessor per `git-workflow/stacking.md`), so a chain occupies
   one implementer slot for its whole duration. Never run a 4th chain
   while three are still in flight; extras queue for the next free slot.
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
   run concurrently. Build-guardian runs once per STACK LEVEL, on that
   level's branch at its stack position, BEFORE that level is submitted —
   the independently-green invariant (`git-workflow/stacking.md`). It runs
   only after that level's implementer has closed and its per-bead
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
   build → e2e) is the build-guardian's job, once per stack level. This is
   how the "no concurrent test suites" invariant is enforced.
7. **Per-level gate, per-chain verification.** Each stack level runs its
   own build-guardian gate before submit; the chain-end verification pass
   (cross-bead-integration-verifier when the chain has >1 bead, then
   architecture-auditor) runs after a chain's levels complete. Steps run
   **in order, not in parallel** within a level and within the chain-end
   pass.

## Wave lifecycle

A wave is a set of ready, enriched dependency CHAINS that the orchestrator
runs together. Chains come from the plan tool
(`npx tsx .claude/tools/stack.ts plan`), which turns an epic's full child
set plus the bd "blocks" edges among them into an ordered forest of chains;
non-linear graphs (cycles, forks, joins) fall back to a flat plan of
singleton chains with a warning. Branch/stack conventions the chains
follow: `git-workflow/stacking.md`.

### 1. Identify ready + enriched chains

Before spawning anything, the orchestrator:

1. Plans chains once per epic from the FULL child set (not `bd ready`,
   which omits blocked mid-chain beads).
2. Each wave, reads the ready set (`bd ready --parent <epic>`) and
   schedules the remaining chains whose HEAD bead is ready. `bd` stays the
   source of cross-chain unblocking, but mid-chain beads are owned by
   their chain runner and are never scheduled directly.
3. Checks enrichment on chain heads before spawn (mid-chain beads are
   re-checked at dispatch time). For any unenriched bead, spawns a
   **general-purpose enrichment subagent** that populates the
   Implementation Context via the `/analyze-bead` Phase 4 flow, then
   re-checks. **Enrichment does NOT count against the 3-slot implementer
   budget** and **does NOT count as a retry against the bead's retry
   limit.** It is a precondition, not an attempt.

### 2. Run chains (max 3 in parallel)

The orchestrator runs ready chains under the 3-slot cap; independent
chains run in parallel, and within a chain beads run strictly
sequentially, each level's branch stacking on its predecessor
(operations: `npx tsx .claude/tools/stack.ts create` / `submit`;
conventions: `git-workflow/stacking.md`).

Concurrency model (hybrid): the first chain of a wave runs in the main
checkout; each ADDITIONAL concurrent chain gets its own git worktree,
with its agents dispatched at that cwd. The orchestrator owns the
worktree lifecycle (create before the chain starts, remove when it
finishes).

Implementers receive the canonical prompt from
[`implementer-prompt-template`](../implementer-prompt-template/SKILL.md).
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
2. Enumerate auditor candidates with `npx tsx .claude/tools/bead.ts agents
   auditor` and select the applicable subset yourself per
   [`agent-discovery`](../agent-discovery/SKILL.md) — match the changed
   files against each candidate's description, defaulting toward
   inclusion.
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
| **FAIL** | Return findings to the implementer for a single retry round. If a second audit still FAILs, escalate via `npx tsx .claude/tools/bead.ts escalate <id> "<reason>"`. |

A stack level is not ready for its build gate until its bead has closed
and **every** matched per-bead auditor for that bead has reported a
resolved verdict (PASS or PASS WITH WARNINGS after any required retry).

### 4. Per-level build gate + per-chain verification

**Per-level build gate — build-guardian (once per stack level, BEFORE
that level's submit)**

- **NEVER more than one build-guardian at a time.** Test suites must
  not run concurrently.
- Spawn exactly one `build-guardian` subagent per stack level, on that
  level's branch at its stack position. It runs the full sequential
  suite internally:
  ```
  pkill -f "vitest" 2>/dev/null || true
  npm run lint
  npx vitest run (unit)
  npx vitest run (integration)
  npm run build
  (e2e as applicable)
  ```
- Build-guardian is the single point where the full test suite runs for
  a level's changes. The implementer's targeted tests proved the bead's
  local correctness; build-guardian proves the level is independently
  green at its stack position (`git-workflow/stacking.md`).
- Verdict handling:
  - 🟢 Pass → submit the level and continue to the next level in the
    chain.
  - 🔴 Fail → see "Build-guardian failure" in failure handling below.
    The level is NOT submitted while red.
- `VERIFY:` whether GitHub CI is the re-validator after a post-merge
  cascade is unconfirmed (see `git-workflow/stacking.md`) — a human must
  confirm the server-side cascade-retarget behaves as expected. Until
  then, build-guardian re-runs locally on the retargeted level after
  every merge, in addition to whenever `syncAndRestack` reports
  conflicted branches.

**Per-chain verification pass (after a chain's levels complete)**

- **cross-bead-integration-verifier** — run only if the chain has > 1
  bead. It looks for conflicts, duplications, and inconsistencies
  between the chain's beads that per-bead auditors miss because each
  bead was verified in isolation.
- **architecture-auditor (light pass)** — always. It reads product docs
  (mission.md, decisions.md, roadmap.md), diffs the chain's combined
  changes, and flags vision drift, decision violations, and conceptual
  fragmentation.
- Verdict handling for both:
  - 🔴 Conflicts / HIGH findings → spawn a follow-up implementer with
    the details, re-run the affected per-bead auditors.
  - 🟡 MEDIUM / LOW → note in the wave summary; address if quick.
  - 🟢 Clean / PASS → chain is complete.
- **This pass is advisory at chain scope — a deliberate change from the
  old wave-end chain, which gated on these verdicts.** Per-level
  submission means the chain's levels are already pushed by the time a
  whole-chain review can run, so it cannot serve as a pre-push gate.
  Blocking integration/architecture verification lives in the
  **epic-completion sweep** (below); the manual bottom-up merge ritual
  (`git-workflow/stacking.md`) is the human checkpoint before anything
  reaches `main`.

### 5. Cascade to the next wave

Once every chain in the wave has finished:

1. Run `bd ready --parent <epic>` to find newly unblocked chain heads
   (e.g. a chain that was waiting on a blocker outside its own chain).
2. Return to step 1 of this lifecycle for the next wave of remaining
   chains.
3. When no remaining chain has a ready head, proceed to the **Epic
   completion sweep** (see below).

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
   `npx tsx .claude/tools/bead.ts enrichment-check <id>`.
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
   - Escalate via `npx tsx .claude/tools/bead.ts escalate <id> "<reason>"`
     (adds `needs-human` label, appends Escalation section, bead is
     skipped on future autonomous runs).
   - Skip the bead and continue the wave without it (only valid if the
     bead does not block other ready beads).

### Build-guardian failure (per-level gate)

If a level's build-guardian fails, the responsible bead is known by
construction — it is that level:

1. Spawn `test-failure-investigator` with the build-guardian's report
   for diagnosis.
2. Spawn a follow-up implementer for the level's bead to fix the issue
   (counts as a retry for that bead).
3. Re-run the per-bead auditor cascade for the fixed bead, then re-run
   the level's build gate.
4. The level is submitted only once its build-guardian reports green.
5. If retries exhaust, the chain HALTS at that level: the failed bead
   and the chain's un-run remainder are escalated (chain truncation) —
   never skip past a broken parent level. Other chains in the wave are
   unaffected.

### Retry limit

- **Maximum 2 retries per bead in wave contexts.**
- Enrichment-then-retry is NOT a retry.
- A "retry" is a fresh implementer spawn after a failed implementation
  attempt (test failure, blocker fix, build-guardian attribution). Each
  retry should include learnings from the previous attempt in the
  spawning context.
- After 2 retries still fail, escalate: call
  `npx tsx .claude/tools/bead.ts escalate <id> "<reason>"`, preserve the
  branch, and stop work on that chain (the bead is labelled `needs-human`
  and will be skipped on future autonomous runs; a human removes the
  label to re-queue).

**Single-leaf exception (autonomous single-bead runs):** When a lone leaf
bead is executed autonomously (not as part of an epic wave), the retry
ceiling is **1** instead of 2. Rationale: a failing implementer on a
solo autonomous bead is almost always a signal that the bead itself needs
human attention (shape issue, missing context, environmental assumption),
not something a second mechanical retry will fix. The tighter ceiling
reaches escalation faster and keeps the autonomous loop from burning
context on beads that cannot self-recover. Epic waves keep the 2-retry
ceiling because a single bead failure within a multi-bead wave is more
often a transient integration issue worth one more attempt.

## Epic completion sweep

Once every wave has closed — no ready beads remain, every wave's
build-guardian has passed, every bead is closed — the orchestrator runs
a final comprehensive sweep before declaring the epic done.

1. **Discover applicable comprehensive agents** via
   [`agent-discovery`](../agent-discovery/SKILL.md):
   - `npx tsx .claude/tools/bead.ts agents auditor` — all `*-auditor`
     agents; keep those whose descriptions indicate comprehensive /
     final-pass scope.
   - `npx tsx .claude/tools/bead.ts agents verifier` — all `*-verifier`
     agents.
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
   (investigator → implementer → rerun the affected level's build gate,
   then redo the sweep).
6. **Close the epic** via `bd close <epic-id>` once all comprehensive
   agents report resolved verdicts.

## Single-leaf reduction

When an orchestrating agent targets a single leaf bead (not an epic), the
same lifecycle applies in its reduced form:

- One wave. One singleton chain. One implementer.
- The per-bead auditor cascade still runs after the implementer closes.
- The verification pass runs with:
  - `cross-bead-integration-verifier` **skipped** (chain size is 1).
  - `architecture-auditor` light pass runs (always).
  - `build-guardian` runs once (always — one bead means one level).
- The epic completion sweep collapses to the same build-guardian pass
  plus the `implementation-verifier` invocation (which is effectively
  the "wave" and "epic" stages merging, since the whole run is one
  bead). Comprehensive auditors matched to the changed files still
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
per-level gate or chain scheduling — should be made **here first**, then
propagated to consumers. Divergence between this skill and a consumer
is a bug; the skill is authoritative.

The skill is deliberately NOT the source of truth for two adjacent
layers: stacking conventions live in `git-workflow/stacking.md`, and the
executable chain/`gh stack` operations (`plan`, `create`, `submit`,
`sync`) live in `.claude/tools/stack.ts` — this skill cross-references
both and restates neither.
