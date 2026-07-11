---
name: Bead Backlog Selection
description: Selection logic, preflight, and escalation tracking for autonomous backlog processing. Use this skill when choosing the next bead for /process-backlog, verifying the environment is safe for autonomous work, or escalating beads that cannot be automated.
---

# Bead Backlog Selection

This skill governs how the autonomous `/process-backlog` command picks its next bead, whether the environment is ready for unattended work at all, and how to permanently mark beads that the automation cannot handle so the loop never retries them forever.

See [`epic-bead-workflow`](../epic-bead-workflow/SKILL.md) for the underlying beads mental model (dependency DAGs, READY beads, enrichment, closing). This skill layers selection, preflight, and escalation on top of that model.

## Implementation

Logic lives in `.claude/orchestrators/lib/helpers.ts`:

| Function | Purpose |
|---|---|
| `preflight(deps)` | Gate. Returns `{ok, failures[]}`; ok=true if safe, false if any blocker. |
| `bdTopReady(limit, deps)` | Picks the top bead. Returns `{bead, exhausted}`; bead=null when no automatable bead remains. |
| `bdEscalate(id, reason, phase, deps)` | Marks a bead as needing human intervention. Idempotent. |

All functions accept an injectable `spawnFn` dependency for testability; pure functions have no I/O.

## Prioritization rules

When picking the next bead, `bd-top-ready.sh` applies these rules in order:

1. **Only READY beads.** `bd ready` already excludes `in_progress`, `blocked`, `deferred`, and `hooked` beads via its blocker-aware semantics. No work to do here.
2. **Filter out `needs-human` label.** Any bead carrying this label is skipped — the human has already decided it can't be automated, or automation tried and gave up. See [Escalation protocol](#escalation-protocol) below.
3. **Priority ascending.** `priority` is an integer where `0` is highest (P0). Sort lowest first.
4. **Age tiebreak — oldest first.** Among beads with equal priority, the oldest `created_at` wins. This keeps beads from lingering indefinitely just because newer, equally urgent work keeps arriving.

**Not used for selection:** bead type (epic vs. leaf), estimated complexity, assignee. The orchestrator asks this skill only "what's next?" and then routes by type afterwards via [`bead-state-assessment`](../bead-state-assessment/SKILL.md).

The `bdTopReady()` function filters out beads with the `needs-human` label via the helpers' label check, respecting the escalation protocol (see below).

## Preconditions for autonomous work

Before `/process-backlog` begins, `preflight()` must return `{ok: true}`. Every failure carries a `kind` field so the orchestrator can route user-facing messaging:

| `kind` | Meaning | User action |
|---|---|---|
| `dirty_tree` | `git status --porcelain` non-empty | Commit or stash first. |
| `behind_main` | HEAD is not at `origin/main`, or `git fetch origin main` failed | Pull/rebase onto `origin/main` (or fix remote access). Any branch name is fine as long as HEAD matches. |
| `missing_gt` | Graphite CLI (`gt`) not installed | Install gt and run `gt init`. Hard stop — no silent fallback to plain git. |
| `gt_unauthenticated` | gt installed but not authenticated | Run `gt auth` interactively. Hard stop. |
| `gt_trunk_misconfigured` | gt trunk is not `main` | Run `gt init --trunk main`. Hard stop. |
| `empty_backlog` | No READY beads exist that aren't `needs-human`-labelled | Shape or enrich more beads, or unlabel one. |

The three gt kinds exist because all branch creation and PR submission goes through gt — command patterns and stacking rules live in the `git-workflow` skill's `stacking.md` (sole source of truth; not restated here).

The preflight check NEVER auto-fixes any of these. It reports what's wrong; the human (or the orchestrator's exit message) decides what to do. Auto-fix is an anti-pattern here because the fix depends on intent: a dirty tree could be in-progress work the user forgot about, and silently stashing it would surprise them.

The default main branch is `main`. Override via `PREFLIGHT_MAIN_BRANCH=<name>` if you run this in a fork with a differently-named default branch. The default `bd ready` sample size is 50; override via `PREFLIGHT_READY_LIMIT=<n>`.

## Escalation protocol

When the autonomous loop decides a bead can't be automated (auto-shape can't extract a useful description, advisors REQUEST CHANGES after refinement, implementation retries exhaust), the orchestrator calls `bd-escalate.sh <id> <reason> [phase]`.

The script does two things:

1. **Adds the `needs-human` label.** Uses `bd label add <id> needs-human` (falls back to `bd update <id> --add-label needs-human` for older bd versions). bd's label store is a set, so re-adding is free.
2. **Appends an `## Escalation (<date>)` section to the bead's notes.** Format:
   ```
   ## Escalation (2026-04-16)

   Phase: 3.5
   Reason: advisor REQUEST CHANGES after one refinement (privacy-advisor flagged PII leak)
   ```
   The script reads the bead's current notes via `bd show <id> --json` and skips the append if today's section already exists. This guarantees idempotency: calling `bd-escalate.sh` twice in one day does not produce two sections.

Escalated beads are reversible: the human reads the Escalation section, fixes the underlying issue (reshape, add context, narrow scope), then removes the label with `bd update <id> --remove-label needs-human`. The bead is then eligible again.

### When the orchestrator escalates

| /process-backlog phase | Trigger |
|---|---|
| 3 (auto-shape) | Description too thin — fewer than 50 chars of signal, no verb/object. |
| 3.5 (advisor review of shaped bead) | Any advisor returns `REQUEST CHANGES` after one refinement round. |
| 5.5 (advisor review of enriched epic plan) | Same as 3.5 but against the enriched plan. |
| 7 (execution) | Implementation retry exhausted. |

The orchestrator passes the phase as the third argument so the Escalation section records which phase gave up.

### Fallback if `bd update --add-label` / `bd label add` disappear

Both commands are verified present in the current bd build. If a future bd release drops label support, `bd-escalate.sh` will silently succeed on the label step (the `|| true` guard) and still write the notes-based Escalation section. For downstream consumers like `bd-top-ready.sh`, the label filter becomes useless in that scenario. The documented fallback is:

- Add the literal marker `[NEEDS-HUMAN]` to the bead's notes as the first line of the Escalation block.
- Update `bd-top-ready.sh` to grep bead notes for `[NEEDS-HUMAN]` in addition to (or instead of) checking labels.

This fallback is not wired up today because the live bd fully supports labels. Leaving it documented keeps the skill resilient to a bd regression.

## When to refuse to start

The skill refuses autonomous work in these situations, via `preflight()` returning `ok: false`:

- **Dirty working tree** — would conflate user work with automation output.
- **HEAD behind `origin/main`** — branching off a stale base makes PRs that conflict with recent merges and forces rebases.
- **gt missing, unauthenticated, or trunk misconfigured** — branch creation and PR submission require a working Graphite setup; falling back to plain git silently would fork the workflow.
- **Empty backlog** — nothing to do. Also triggered when every READY bead is `needs-human`-labelled.

The orchestrator surfaces these reasons to the user verbatim and exits. It does NOT prompt, retry, or auto-fix. The human sees the failure and acts, or invokes `/process-backlog` again once the condition clears.

## Consumers

- `/process-backlog` — the autonomous command, calls all three scripts.
- Future backlog-management commands — may reuse `bd-top-ready.sh` for "what's next?" queries or `bd-escalate.sh` for manual escalation.

## Tests

Tests are co-located with the orchestrator codebase in `.claude/orchestrators/lib/__tests__/`. The test suite covers:

- **preflight():** clean pass, dirty tree, wrong branch, stale main, empty backlog, all-labelled backlog.
- **bdTopReady():** priority ordering, age tiebreak, label filter, null bead when all-labelled, null bead when empty.
- **bdEscalate():** label added, notes appended, idempotent second call, phase recorded in Escalation section.
