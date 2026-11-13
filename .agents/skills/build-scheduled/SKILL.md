---
name: build-scheduled
description: Use when running `/spawn-bead-workers --scheduled` (the unattended epic build), when reading or writing a `spec:building`, `spec:built`, `spec:stalled` or `build:hold` label, a `## Build state` or `## Build stall` notes block, or the `reports/spawn-bead-workers/` run report, or when another command needs to know which roots the scheduled builder holds.
---

# Build, scheduled

The unattended mode of `/spawn-bead-workers`, modelled on `/plan --scheduled`.
It builds at most one root per run, never waits on a human, and writes a
report. Chain mechanics stay
[`bead-wave-orchestration`](../bead-wave-orchestration/SKILL.md)'s; this
skill adds what goes around them.

## Overrides of the attended flow

The attended phases apply as written, except:

- **No questions.** Phase 2 proceeds with every enriched chain; an
  unenriched leaf goes to the enrichment subagent, as attended.
- **Missing epic analysis** (no Bead Analysis heading): skip the root with a
  report line; never offer `/analyze-bead`.
- **Phase 1's `spec:ready` removal** becomes the `spec:building` write, so a
  `spec:*` label holds mid-chain leaves away from `/clear-backlog`.
- **Root status.** Never change it or `bd close` the root; the sweep's close
  step is skipped. The maintainer closes it after merging.
- **Escalation.** Leaf escalation and chain truncation as the wave skill
  defines them; never escalate the root — its failure state is `spec:stalled`.
- **Implementation blocker.** One retry with an adjusted approach (counted);
  then leaf escalation and chain truncation.
- **Sweep failure no level owns** (a merge conflict between chains):
  `spec:stalled`, finding in the root's notes.
- **Stalling with other chains in flight.** In-flight levels run to their
  verdict and green ones are submitted; then `spec:stalled`, and stop.
- **Never merges.** The run ends at PR creation; implementers get the
  canonical `implementer-prompt-template` prompt with nothing appended.

## Preflight, gates and selection

`validate-flags` first: `--scheduled` takes no epic id and no other attended
flag. Then **preflight**, failing closed in order: the report path is
gitignored; the run lock (`runPreflight` in `scripts/lib/build.ts`) — labels
cannot stop two overlapping firings, the lock can, one scheduled checkout
per host; a clean tree at the trunk. No repository setting is read.

**Gates**, in order; a failure ends the run with one report line. Any
non-zero exit, bad JSON, missing field, or `gh pr list` result as long as
its `--limit` fails the gate.

1. **Resume first.** An open `spec:building` root without `build:hold` or
   `needs-human` is taken; skip gates 2 and 4.
2. **Prior epic in review.** An open PR is recorded in the last Build state
   block of a `spec:built` root, open or closed, or that block is missing.
3. **Queue gate.** `/clear-backlog`'s, thresholds unchanged, the epic's own
   levels counted. Re-read (`gates --queue-only`) before every new level.
4. **Nothing to build.** Selection finds no root.

**Selection**: the open `spec:ready` root that reached it earliest, ties by
id. bd records no label events, so that is `updated_at`, named as the
`source` in the report. Skipped with a reason: `build:hold` (maintainer-only),
`needs-human`, no Bead Analysis heading, a Build state block already present.

**Decision leaves.** Never dispatch a `decision`-type `Decide:` leaf. If the
only open leaves are blocked on one, note it on the root and in the report,
and leave the root `spec:building`.

Every exit after preflight, a failed gate included, ends with
`release --owner-pid $PPID`; the lock is otherwise freed only when its pid
dies.

## Labels and the kill switch

Every write to the root goes through `build.ts write`: it re-reads the root,
applies the write guard and makes **one** `bd update` with the state-write
flags and `--append-notes`, passing every text as argv. Never compose a
`bd update` on the root by hand, and never use `--notes`.

- **`spec:ready` → `spec:building`**, before the first implementer spawns:
  `write <root> --label spec:building --state-file <json>` with the first
  block (firings 0, no submitted level, each chain's first branch as
  `next`).
- **`spec:built`**: set by the completion sweep's flow, with every chain at
  `next: done`.
- **`spec:stalled`**, on any failure the retries cannot clear: a block with
  `stopped: stalled` plus `--stall-step <step> --stall-file <report>`; the
  script fences the report in a separate `## Build stall` block. A malformed
  last block is stalled with no `--state-file`.
- **Out of `spec:built` or `spec:stalled`**: the maintainer only.

**Kill switch.** Before every level start, every `stack.ts submit` and
every `gh pr edit`, run `still-ours <root>`; `write` applies the same check
before every label write. On exit 1 (`build:hold` or `needs-human` now set,
the `spec:*` label no longer `spec:building`, or the root closed): stop at
that point, write nothing more, one report line.

## Note blocks

`## Build state` (optional ` (<suffix>)`) is append-only; readers take the
last one outside fenced text, and a malformed last block stalls the root
with no fallback. It is written with the `spec:building` write, after each
level is submitted, and at every stop (`stopped: <reason>`). `write` takes
the state as JSON — the `state` object `build-state` prints, edited — and
formats it. Body, these lines only:

```
firings: <0..MAX_FIRINGS>
restart: none | resume
chain <k>: <branch> → #<pr>, <branch> → #<pr>; next: <branch | done>
stopped: <reason | none>
```

`MAX_FIRINGS` lives in `scripts/lib/build.ts`. Chains number from 1; `-`
means no submitted level; branches follow `git-workflow/branches.md`.
`## Build stall` holds `step: <failing step>` and the investigator's report
in a fence longer than any backtick run in it, so no heading in it is ever
read.

## Counted firings and restart

`build-state <root>` prints the start decision. `start`: a `spec:ready`
root. `continue`: the last block's `firings`. `restart`: the last block
says `stopped: stalled` but the root is `spec:building` again — the
maintainer moved it back — so the next block carries `restart: resume`,
the submitted levels, and `firings: 0`. `stall` (exit 1): a `spec:ready`
root that already has a block, a malformed or missing block, or a plan
that no longer matches the block — stall it with the reason. There is no
start-over: a rebuild is reset by hand.

At every stop, `nextFiringCount(prev, kind)` in `scripts/lib/build.ts` gives
the `firings` to record. Only a firing that started or resumed a level
counts; a gate skip, a dry run, a decision-blocked firing and a kill-switch
stop before any level do not. When it returns `stall`, the firing still
leaves the root `spec:building` on its `MAX_FIRINGS`-th count: write
`spec:stalled` with that reason instead.

## Resume

A `spec:building` root continues from its last block, never from the
local checkout:

1. **Validate.** `validate-prs <root>` before any checkout, push or edit
   of a recorded PR. Exit 1 stalls the root and touches no PR.
   `sync_first` means a lower level merged: run `stack.ts sync` first.
2. **Restore.** `gh stack checkout <pr>` on each chain's `top` PR, in the
   checkout that carries that chain (its own worktree for chains past the
   first, per the wave skill's "Resuming an interrupted run").
3. **Redo.** Each leaf in `redo` (in progress or closed, no submitted
   level) is redone from its bead. Discard its work only on that chain's
   recorded and next branches — never the trunk or another chain's branch.
   The implementer's budget-cut `wip: <bead-id> …` commit goes with that
   discard, so it never reaches a submit or the text check; if this rule
   ever keeps branch work, that commit becomes a stall on every budget cut.
4. Continue each chain at `nextBead`; chains recorded `done` stay done.

## Stop points

- Never stop between a level's implementer closing its bead and that
  level's build-guardian verdict.
- Before starting a level: `still-ours`, then `gates --queue-only`, then
  AGENTS.md's Budget Signals bands and `/clear-backlog`'s run-level stop
  rule. Start it only if it can reach its verdict in the session left. With
  no `[budget]` signals, continue level by level; a cut costs at most the
  in-flight level, which resume redoes.
- On a failure the retries cannot clear with other chains in flight, run
  those levels to their verdict, submit and record the green ones, then
  write `spec:stalled` and stop; start no other root.
- Every stop writes its block, appends the report line, and releases the
  lock.

## Report

`reports/spawn-bead-workers/<YYYY-MM-DD>.md`, only after the report-path
check passes; a later run that day appends `## Run <HH:MM>`. Create it
before the first dispatch with the preflight and gate readings and the
selection. Append as it happens: a level submitted (PR number), a level
gated red (the investigator's one-line finding), a retry, a label change,
a kill-switch stop, the run stopping and why. Bead ids are allowed here, never in GitHub text.

## Tooling

`build.ts` means `npx tsx .agents/skills/build-scheduled/scripts/build.ts`;
run it with no command for its usage. Pass `preflight --owner-pid $PPID`:
under the Bash tool `$PPID` is the agent session, which outlives each
short-lived CLI call, so the lock stays held for the whole run; `release`
takes the same pid. Write `write`'s inputs to files in the session
scratchpad. `state-write` only prints a label write's flags. The dry run
evaluates every check where a real run stops at the first failure, then
still selects, plans chains and prints the label write; it writes nothing.
