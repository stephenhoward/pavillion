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

`validate-flags` first: `--scheduled` refuses an epic id, `--only`,
`--sequential`, `--resume` and unknown flags. Then **preflight**, failing
closed in order: the report path is gitignored; the lock
(`reports/spawn-bead-workers/.lock`, `{pid, started}`; live holder stops the
run, dead holder is replaced, malformed fails) — labels cannot stop two
overlapping firings, the lock can, one scheduled checkout per host; a clean
tree at the trunk (`stack.ts safe-to-start`). No repository setting is read.

**Gates**, in order; a failure ends the run with one report line. Any
non-zero exit, bad JSON, missing field, or `gh pr list` result as long as
its `--limit` fails the gate.

1. **Resume first.** An open `spec:building` root without `build:hold` or
   `needs-human` is taken; skip gates 2 and 4.
2. **Prior epic in review.** An open PR is recorded in the last Build state
   block of a `spec:built` root, open or closed.
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

## Note blocks

`## Build state` (optional ` (<suffix>)`) is append-only; readers take the
last one outside fenced text, and a malformed last block stalls the root
with no fallback. Body, these lines only:

```
firings: <0-3>
restart: none | resume
chain <k>: <branch> → #<pr>, <branch> → #<pr>; next: <branch | done>
stopped: <reason | none>
```

Chains number from 1; `-` means no submitted level; branches are
`<type>.<kebab>` per `git-workflow/branches.md`. `## Build stall` holds
`step: <failing step>` and the investigator's report in a four-backtick
fence, so no heading in it is ever read.

## Report

`reports/spawn-bead-workers/<YYYY-MM-DD>.md`, only after the report-path
check passes; a later run that day appends `## Run <HH:MM>`. Create it
before the first dispatch with the preflight and gate readings and the
selection. Append as it happens: a level submitted (PR number), a level
gated red (the investigator's one-line finding), a retry, a label change,
the run stopping and why. Bead ids are allowed here, never in GitHub text.

## Tooling

`build.ts <command>` means
`npx tsx .agents/skills/build-scheduled/scripts/build.ts <command>`:

```
validate-flags <argv…>       exit 1 + message on a refused combination
preflight --owner-pid $PPID  JSON readings; takes the lock ($PPID: the agent session)
gates [--queue-only]         JSON: each gate's reading and verdict, in order
select                       JSON: root, ordering source, skipped roots
build-state <root>           JSON: the parsed last Build state block; exit 1 if malformed
state-write <spec:label>     bd update flags: spec:building | spec:built | spec:stalled
dry-run                      JSON: preflight, gates, selection, chain plan, label write
```

A state write's flags go in the same `bd update` as its notes block. The
**dry run** evaluates every check (a real run stops at the first failure),
then still selects, plans chains and prints the label write; it writes no
label, note, report, lock or branch. Every command shells out with an argv
array, never a shell, and validates root ids first. Tests:
`npx vitest run --config .agents/tools/vitest.config.ts`.
