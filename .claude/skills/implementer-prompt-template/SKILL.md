---
name: implementer-prompt-template
description: Canonical minimal prompt pattern for dispatching a bead implementer subagent. Use this skill when spawning an implementer for a single leaf bead, when spawning implementers inside an epic wave, or when evolving the implementer prompt so every orchestrating command (/spawn-bead-workers, /clear-backlog, future commands) shares one source of truth.
---

# Implementer Prompt Template

This skill captures the canonical prompt pattern for a bead **implementer**
subagent. The implementer is the worker that turns an analyzed bead into
code, closes the bead, and hands off to downstream verification. Its prompt
is intentionally minimal: the bead itself carries all the implementation
context, and the implementer must read it directly rather than having the
context re-summarized in the spawn prompt.

This is a prose-only skill. There are no scripts. Every orchestrator that
dispatches an implementer should reference this skill so the rules below
stay in exactly one place.

Consumers: `/spawn-bead-workers` (epic-wave variant), `/clear-backlog`
(documented lightweight variant), and any future orchestrating command that
dispatches a single-leaf implementer.

## Why the prompt is minimal

The bead record is the source of truth. `bd show <id>` returns the full
DESCRIPTION, DESIGN, ACCEPTANCE CRITERIA, and NOTES — including the
**Implementation Context** block populated by `/analyze-bead`. Re-summarizing
that content in the spawn prompt would duplicate information (and risk
drifting from the bead), so the orchestrator's job is to hand the
implementer a bead id and let the implementer read the bead.

Two things follow from this:

1. The implementer must **refuse** to proceed if the bead has not been
   analyzed. Synthesizing the Implementation Context from the description
   would defeat the purpose of having an analysis phase — analysis exists
   so the implementer has a roadmap, not guesses.
2. Cross-cutting behavior — the refusal protocol, the pre-close checklist,
   the "never run the full suite" rule — lives in the prompt, not in the
   bead. The bead is per-task context; the prompt is per-role discipline.

## The canonical prompt

This is the authoritative template. Every orchestrator that spawns an
implementer should render this prompt verbatim, substituting `{bead_id}`
with the actual bead identifier. Do not paraphrase; do not trim.

```markdown
# Implement Bead: {bead_id}

Read your bead for the full task description and implementation context:

```bash
bd show {bead_id}
```

**IMPORTANT: Check for notes before starting.** The NOTES section must contain
implementation context (files to modify, skills, standards, acceptance criteria).
If the bead has NO notes or no "Implementation Context" section, STOP immediately
and report: "Bead {bead_id} is not enriched. Cannot implement without notes."
Do NOT attempt to research or enrich the bead yourself.

The DESCRIPTION tells you what to build. The NOTES contain your implementation
roadmap. If a spec is referenced, read it for broader context.

Follow TDD. Stay scoped to the files listed.

**Before closing:**

1. Kill any stale vitest processes: `pkill -f "vitest" 2>/dev/null || true`
2. Run lint: `npm run lint`
3. If the bead notes list specific test files under "Relevant Tests", run those
   targeted tests only (not the full suite):
   ```bash
   npx vitest run <file1> <file2> --maxThreads=2
   ```
4. If lint and targeted tests pass: `bd close {bead_id}`

Do NOT run `npm test` or the full test suite — the build-guardian handles that
once per wave after all beads complete. Do NOT close the bead if lint or
targeted tests are failing. If blocked, report back.
```

## Behavioral rules the prompt encodes

Each rule below is the prose rationale behind a line in the template above.
If you are evolving the template, preserve these rules or explicitly retire
them with a decision record.

### 1. Read the bead first

The implementer's first action is `bd show {bead_id}`. No exceptions. The
orchestrator must not paste bead content into the spawn prompt, because
doing so would hide drift between the prompt and the live bead. If the bead
has been edited between spawn and execution (e.g. during a retry), the
implementer must see the current version.

### 2. Refusal protocol (unenriched beads)

If the bead's NOTES section does not contain an "Implementation Context"
block, the implementer **must stop and report**: `"Bead {bead_id} is not
enriched. Cannot implement without notes."` It must not research the
codebase, fabricate files-to-modify, or guess at standards — doing so
skips the analysis phase and produces work the advisors never reviewed.

The deterministic check for enrichment is
[`bead-state-assessment`](../bead-state-assessment/SKILL.md)'s
`npx tsx .claude/tools/bead.ts enrichment-check <id>` command: exit 0 means
enriched, exit 1 means not. The implementer may run it as a first step, but
the `/spawn-bead-workers` Phase 2 enrichment check normally guarantees that
any bead reaching the implementer is already enriched. The refusal protocol
exists as a defence-in-depth backstop for the case where the gate missed it.

### 3. TDD is the expected workflow

The prompt says "Follow TDD" deliberately. Tests first, implementation
second, refactor third. The bead's Implementation Context lists the
Relevant Tests the implementer should write or update; the implementer
uses those as the write-failing-test target before writing production
code. This matches the repository's testing standards and also ensures
the targeted test run in the pre-close checklist actually exercises the
changed code.

### 4. Stay scoped to the files listed

The bead's `## Files to Modify` section is the scope contract. An
implementer that edits files outside that list is violating the plan the
advisors reviewed in Phase 3.5. If a genuinely unavoidable out-of-scope
change surfaces during implementation, the implementer should stop and
report it — not silently expand scope.

### 4b. Commit to the branch the orchestrator prepared

The implementer commits to whatever branch (and checkout) the
orchestrator prepared before dispatch. That branch may be a stack level —
a per-bead branch stacked on a sibling bead's branch rather than on
`main` — and may live in a dedicated git worktree. This is invisible to
the implementer: it never creates, switches, or submits branches itself
(stacking conventions: `git-workflow/stacking.md`; scheduling:
[`bead-wave-orchestration`](../bead-wave-orchestration/SKILL.md)).

### 5. Pre-close checklist (in order)

Before the implementer calls `bd close`, it must run these four steps in
order:

1. **Kill stale vitest processes.** `pkill -f "vitest" 2>/dev/null || true`.
   A previous run in the same shell session can leave watcher processes
   holding ports or consuming resources; killing them up front prevents
   mysterious hangs on the targeted run.
2. **Lint.** `npm run lint`. This is cheap and catches style / type
   regressions before the build-guardian runs the full suite later. Must
   pass.
3. **Targeted tests.** `npx vitest run <file1> <file2> --maxThreads=2`
   where the file list comes from the bead's `## Relevant Tests` section.
   `--maxThreads=2` keeps the run responsive without flooding the
   machine. Must pass.
4. **Close the bead.** `bd close {bead_id}`, **only** if steps 2 and 3
   both passed. A closed bead signals to the orchestrator that this
   worker is done; closing on failing tests would corrupt that signal.

### 6. NEVER run the full suite

The prompt explicitly forbids `npm test`, `npm run test:*`, or any other
command that runs the whole test suite. The full suite is the
**build-guardian**'s responsibility (see variants below). The rationale:

- Running the full suite from multiple parallel implementers would cause
  concurrent test execution, which is explicitly banned in the
  orchestration skill (test suites must not run concurrently).
- Running the full suite per bead wastes minutes on every run; the
  build-guardian amortizes that cost across a whole wave or run.
- The build-guardian runs the suite **after** all implementers have
  closed, so failures are attributable to real committed work, not
  mid-implementation churn.

### 7. Report back if blocked

If the implementer cannot complete the work (missing dependency,
unexpected codebase state, ambiguous bead, failing test that indicates
the plan is wrong), it must stop and report the blocker to the
orchestrator. It must not close the bead, and it must not paper over the
issue. The orchestrating agent decides whether to retry, investigate, or
escalate (`npx tsx .claude/tools/bead.ts escalate <id> "<reason>"` — the
needs-human protocol in [`epic-bead-workflow`](../epic-bead-workflow/SKILL.md)).

## Variants

The prompt template itself is identical across variants. What differs is
the orchestration context around the implementer — specifically, how and
when the full test suite (build-guardian) runs. Understanding this split
lets orchestrators document guarantees correctly for their downstream
verification agents.

### Single-leaf variant (a lone leaf bead)

Used when the bead being processed is a single analyzed leaf (not an
epic). Flow:

1. Orchestrating agent spawns **one** implementer subagent with the
   canonical prompt above.
2. Implementer runs pre-close checklist (kill vitest, lint, targeted
   tests) and calls `bd close {bead_id}`.
3. Orchestrating agent spawns **per-bead auditors** matched to the changed
   files via the [`agent-discovery`](../agent-discovery/SKILL.md) skill.
4. Orchestrating agent spawns **one** `build-guardian` for the whole run
   (there is only one bead, so "per wave" and "per run" collapse to the
   same thing).
5. If build-guardian passes → proceed to PR. If it fails → retry once,
   then escalate via `npx tsx .claude/tools/bead.ts escalate`.

Key property: the implementer's pre-close targeted tests prove the
changed code's correctness locally; the single build-guardian run proves
the overall suite still passes after the change. The implementer never
runs the full suite.

### Epic-wave variant (`/spawn-bead-workers` on an epic)

Used when multiple analyzed leaves are spawned together in a wave (max 3
parallel per [`bead-wave-orchestration`](../bead-wave-orchestration/SKILL.md)).
Flow:

1. Orchestrator schedules dependency CHAINS (up to 3 in parallel — the
   cap applies to chains) and spawns one implementer at a time per
   chain, each with the canonical prompt above (substituting each
   bead's id). See [`bead-wave-orchestration`](../bead-wave-orchestration/SKILL.md)
   for the chain lifecycle.
2. Each implementer independently runs its own pre-close checklist —
   kill vitest, lint, targeted tests on its own file list, close its own
   bead. No coordination between implementers; parallel chains run in
   separate checkouts, and beads within a chain run sequentially.
3. As each implementer closes, orchestrator spawns that bead's matched
   **per-bead auditors** (via [`agent-discovery`](../agent-discovery/SKILL.md);
   these are lightweight and parallel).
4. After a bead's auditors resolve, the orchestrator runs **one**
   `build-guardian` for that stack level, before the level's branch is
   submitted. Never more than one build-guardian at a time — test
   suites must not run concurrently.
5. If build-guardian passes → the level is submitted and the chain
   advances. If it fails → orchestrator spawns
   `test-failure-investigator`, retries the level's bead, re-runs the
   build-guardian; exhausted retries halt the chain.

Key property: the serialized per-level build-guardian is what makes the
"never run the full suite" rule safe for implementers. Multiple
implementers running the full suite in parallel would break the
no-concurrent-test-suites invariant.

### Why the implementer prompt is identical in both variants

Because the implementer's job is identical in both variants: write code,
run lint, run targeted tests on its own files, close its bead. The
orchestration difference (single build-guardian for the run vs. one per
wave) is entirely the orchestrator's concern and is invisible to the
implementer. Keeping the prompt stable across variants is how this skill
stays a single source of truth.

## Evolution and source of truth

Before this skill existed, the prompt was inlined at
`.claude/commands/spawn-bead-workers.md` (lines 138-176 at extraction
time). Once this skill is in place, consumers should reference it by
skill name instead of re-inlining the prompt. Any behavioral change to
the prompt (new pre-close step, changed refusal wording, different test
runner invocation) should be made **here first**, then propagated to
consumers. Divergence between this skill and a consumer is a bug; either
the consumer is outdated or the skill is.

## Cross-references

- [`epic-bead-workflow`](../epic-bead-workflow/SKILL.md) — the bead
  semantics the implementer's refusal protocol depends on (what DESCRIPTION,
  NOTES, Implementation Context mean).
- [`review-mode-auditor`](../review-mode-auditor/SKILL.md) — the auditor
  contract that per-bead auditors follow after the implementer closes;
  the implementer's pre-close discipline (lint + targeted tests) is what
  makes the auditor's read-only analysis reliable.
- [`bead-state-assessment`](../bead-state-assessment/SKILL.md) — home of
  the `bead.ts enrichment-check` command that the implementer may run as a
  pre-flight (belt-and-braces behind the pre-spawn gate) and the
  `bead.ts state` classifier the orchestrating agent uses to decide whether
  a bead is ready for an implementer at all.
- [`agent-discovery`](../agent-discovery/SKILL.md) — used by the
  orchestrator (not the implementer) to pick the per-bead auditors that
  run after `bd close`.
- [`bead-wave-orchestration`](../bead-wave-orchestration/SKILL.md) — the
  wave lifecycle that encodes the "one build-guardian at a time, once
  per stack level" invariant the epic-wave variant relies on.
- [`epic-bead-workflow`](../epic-bead-workflow/SKILL.md) — the needs-human
  escalation protocol the orchestrating agent follows when the implementer
  reports a blocker or a retry exhausts.
