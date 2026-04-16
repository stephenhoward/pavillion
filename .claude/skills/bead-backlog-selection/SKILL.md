---
name: Bead Backlog Selection
description: Selection logic, preflight, and escalation tracking for autonomous backlog processing. Use this skill when choosing the next bead for /process-backlog, verifying the environment is safe for autonomous work, or escalating beads that cannot be automated.
---

# Bead Backlog Selection

This skill governs how the autonomous `/process-backlog` command picks its next bead, whether the environment is ready for unattended work at all, and how to permanently mark beads that the automation cannot handle so the loop never retries them forever.

See [`epic-bead-workflow`](../epic-bead-workflow/SKILL.md) for the underlying beads mental model (dependency DAGs, READY beads, enrichment, closing). This skill layers selection, preflight, and escalation on top of that model.

## Scripts in this skill

| Script | Purpose |
|---|---|
| `preflight.sh` | Gate. Emits JSON `{ok, failures[]}`; exits 0 if safe, 1 if any blocker. |
| `bd-top-ready.sh [--limit N]` | Picks the top bead. Emits bead JSON on stdout; exit 3 when no automatable bead remains. |
| `bd-escalate.sh <id> <reason> [phase]` | Marks a bead as needing human intervention. Idempotent. |

All scripts use `set -euo pipefail`, emit JSON via `jq`, and fail loud on bd CLI errors.

## Prioritization rules

When picking the next bead, `bd-top-ready.sh` applies these rules in order:

1. **Only READY beads.** `bd ready` already excludes `in_progress`, `blocked`, `deferred`, and `hooked` beads via its blocker-aware semantics. No work to do here.
2. **Filter out `needs-human` label.** Any bead carrying this label is skipped — the human has already decided it can't be automated, or automation tried and gave up. See [Escalation protocol](#escalation-protocol) below.
3. **Priority ascending.** `priority` is an integer where `0` is highest (P0). Sort lowest first.
4. **Age tiebreak — oldest first.** Among beads with equal priority, the oldest `created_at` wins. This keeps beads from lingering indefinitely just because newer, equally urgent work keeps arriving.

**Not used for selection:** bead type (epic vs. leaf), estimated complexity, assignee. The orchestrator asks this skill only "what's next?" and then routes by type afterwards via [`bead-state-assessment`](../bead-state-assessment/SKILL.md).

## Preconditions for autonomous work

Before `/process-backlog` begins, `preflight.sh` must return `{ok: true}`. Every failure carries a `kind` field so the orchestrator can route user-facing messaging:

| `kind` | Meaning | User action |
|---|---|---|
| `dirty_tree` | `git status --porcelain` non-empty | Commit or stash first. |
| `wrong_branch` | Current branch is not `main` | Return to `main` (or finish the current branch's PR). |
| `stale_main` | Local `main` differs from `origin/main`, or `git fetch origin main` failed | `git pull` (or fix remote access). |
| `empty_backlog` | No READY beads exist that aren't `needs-human`-labelled | Shape or enrich more beads, or unlabel one. |

The preflight script NEVER auto-fixes any of these. It reports what's wrong; the human (or the orchestrator's exit message) decides what to do. Auto-fix is an anti-pattern here because the fix depends on intent: a dirty tree could be in-progress work the user forgot about, and silently stashing it would surprise them.

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

The skill refuses autonomous work in these situations, via `preflight.sh` returning `ok: false`:

- **Dirty working tree** — would conflate user work with automation output.
- **Wrong branch** — branching off anything other than `main` would produce a PR with unrelated commits.
- **Stale `main`** — branching off a stale base makes PRs that conflict with recent merges and forces rebases.
- **Empty backlog** — nothing to do. Also triggered when every READY bead is `needs-human`-labelled.

The orchestrator surfaces these reasons to the user verbatim and exits. It does NOT prompt, retry, or auto-fix. The human sees the failure and acts, or invokes `/process-backlog` again once the condition clears.

## Consumers

- `/process-backlog` — the autonomous command, calls all three scripts.
- Future backlog-management commands — may reuse `bd-top-ready.sh` for "what's next?" queries or `bd-escalate.sh` for manual escalation.

## Fixture tests

Tests live in `test/`. Each `test-*.sh` file mocks `git` and `bd` via a temporary `PATH` shim populated from env vars (see `test/helpers.sh`). Run them with:

```bash
bash .claude/skills/bead-backlog-selection/test/run-tests.sh
```

Coverage:

- **Preflight:** clean pass, dirty tree, wrong branch, stale main, empty backlog, all-labelled backlog.
- **Top-ready:** priority ordering, age tiebreak, label filter, exit-3 on all-labelled, exit-3 on empty, bad-args exit-2.
- **Escalate:** label + notes added, idempotent second call, missing args exit-2, phase recorded.
