---
name: build-scheduled
description: Use when running `/spawn-bead-workers --scheduled` (the unattended epic build), when reading or writing a `spec:building`, `spec:built`, `spec:stalled` or `build:hold` label, a `## Build state` or `## Build stall` notes block, or the `reports/spawn-bead-workers/` run report, or when another command needs to know which roots the scheduled builder holds.
---

# Build, scheduled

The unattended mode of `/spawn-bead-workers`, modelled on `/plan
--scheduled`: at most one root per run, no human, a report. Chain
mechanics stay [`bead-wave-orchestration`](../bead-wave-orchestration/SKILL.md)'s;
this skill adds what goes around them. `build.ts` means
`npx tsx .agents/skills/build-scheduled/scripts/build.ts` (no command: usage).

## Overrides of the attended flow

The attended phases apply as written, except:

- **No questions.** Phase 2 proceeds with every enriched chain.
- **Missing epic analysis** (no Bead Analysis heading): skip the root with a
  report line; never offer `/analyze-bead`.
- **Phase 1's `spec:ready` removal** becomes the `spec:building` write, so a
  `spec:*` label holds mid-chain leaves away from `/clear-backlog`.
- **Root status.** Never change it or `bd close` the root; the sweep's close
  step is skipped. The maintainer closes it after merging.
- **Escalation.** An implementation blocker gets one counted retry with an
  adjusted approach, then leaf escalation and chain truncation as the wave
  skill defines them. Never escalate the root: it goes to `spec:stalled`.
- **Stalling with other chains in flight.** In-flight levels run to their
  verdict and green ones are submitted and recorded; then `spec:stalled`,
  and stop without starting another root.
- **Never merges.** The run ends at PR creation; implementers get the
  canonical `implementer-prompt-template` prompt with nothing appended.

Never: run `gh pr merge`, set auto-merge (`enablePullRequestAutoMerge`, `gh pr merge --auto`), run `git push --force`, `gh repo edit` or any `gh api` write; pushing happens only inside `stack.ts submit`.

Nothing in the repo stops a token with merge rights. Give the scheduler
slot one with no merge or admin rights (the maintainer's to enforce).
[`slot-settings.json`](slot-settings.json) is a deny list against
accidents, not enforcement: shell wrappers, `env`, gh aliases,
`npx tsx -e`, `git -C` and MCP merge tools reach around prefix rules.

## Preflight, gates and selection

`validate-flags`, then `preflight --owner-pid $PPID`, then `gates`; each
prints its readings and fails closed, and a failure ends the run with one
report line. The lock is one run per host (labels cannot stop overlapping
firings); no repository setting is read. Every exit after preflight, a
failed gate included, ends with `release --owner-pid $PPID`.

`gates` prints the selection: a `spec:building` root resumes first,
otherwise the earliest `spec:ready` root, with each skipped root and its
reason. `build:hold` is maintainer-only. Never dispatch a `decision`-type
`Decide:` leaf; if the only open leaves are blocked on one, note it on the
root and in the report, and leave the root `spec:building`.

## Labels and the kill switch

Every write to the root is `build.ts write`: a re-read, the write guard,
then **one** `bd update` with the label flags and `--append-notes`, argv
only, never `--notes`. It computes `firings` from `--firing`; never count
by hand. Its inputs are scratchpad files.

- **`spec:building`** is written over `spec:ready` with the first block
  before the first implementer spawns; **`spec:built`** by the completion
  sweep's flow; **`spec:stalled`** on any failure the retries cannot clear.
  Only the maintainer moves a root out of `spec:built` or `spec:stalled`.
- A stall takes `--stall-step`, a closed vocabulary the script checks, and
  the investigator's report as `--stall-file`. No failure text is ever typed
  on a command line. If a stall `write` is refused, report it and stop.

**Kill switch.** Run `still-ours <root>` before every level start;
`submit-check`, `publish-pr` and `write` apply it themselves. On exit 1,
stop there, write nothing more, and add one report line.

## Build state

`## Build state` is append-only; readers take the last one outside fenced
text, and a malformed last block stalls the root with no fallback. It is
written with `spec:building`, after each level is submitted, and at every
stop, from the `state` object `build-state` prints, edited
(`write --state-file`).

`build-state <root>` prints `start.action`: `start` writes the first
block; `continue` resumes; `restart` resumes with `restart: resume` in its
first block (the maintainer moved a stalled root back); `stall` stalls
with step `build-state`. There is no start-over.

## Resume and stop points

Resume follows the wave skill's "Resuming an interrupted run", from the
last block, never the local checkout. On top of it:

1. `validate-prs <root>` before any checkout, push or edit of a recorded
   PR. Exit 1 stalls the root (step `validate-prs`) and touches no PR. This
   includes a `next` branch already on origin: a cut between submit and the
   block write. `sync_first` means run `stack.ts sync` first.
2. `gh stack checkout <pr>` on each chain's `top` PR, each chain in its own
   checkout (`git-workflow/stacking.md` "Worktree mode").
3. Redo each leaf in `redo`. The only discard is a local reset or delete
   of that chain's `next` branch; a submitted branch is only ever reset to
   `origin/<branch>`. The budget-cut `wip: <bead-id> …` commit goes with
   the discard; if this rule ever keeps branch work, it stalls every cut.

Never stop between a level's implementer closing its bead and that level's
build-guardian verdict. Before each new level run `still-ours`, then
`gates --queue-only`, then AGENTS.md's Budget Signals bands and
`/clear-backlog`'s run-level stop rule. Start the level only if it can
reach its verdict in the session left. With no `[budget]` signals, go on
level by level. Every stop writes its block, adds its report line and
releases the lock.

## Completion

Once every chain is at `next: done`, run the wave skill's completion sweep
over every chain. A FAIL follows its failure path; one the retries cannot
clear, a conflicting integration merge (no level owns it) or a security
finding stalls the root (step `sweep`, finding in the stall file). On a
pass, in order:

1. Append the completion report to the end of each chain's top PR's
   Validation section (current body from `gh pr view <n> --json body`)
   and publish it with `publish-pr`: verifier names with verdicts
   (`security-auditor` and `privacy-auditor` as pass or fail only), chain
   and changed-file counts, and the sibling chains' top PRs as `#<n>`,
   references across separate stacks, not a "Stacked on" line.
2. `validate-prs <root> --text`: every recorded PR's published title, body
   and branch; exit 1 stalls the root (step `text-check`).
3. `write <root> --label spec:built --state-file <file> --firing ended`.

## Publication guards

PR titles and bodies are composed from structured facts: the
`git-workflow/pull-requests.md` template written from the level's diff,
verifier names with pass or fail, file counts, sibling top-PR numbers.
Nothing comes from bead text, investigator output, verifier findings or
the epic description; findings stay in the notes and the report
([DEC-016](../../../docs/decisions/dec-016-health-report-disclosure-boundary.md)).

A level is published, in its checkout, by `submit-check <root> --leaf
<id> --base <branch>`, then `stack.ts submit`, then `publish-pr <root>
<pr> --leaf <id> --title-file <f> --body-file <f>`, the only way the run
sets a PR's title or body. On `"hold": true` (a `security` or `cve-watch`
leaf) the level stays unsubmitted and the root stalls at `chain <k> level
<n> submit`; any other rejection publishes nothing and stalls it at
`text-check`. History is never amended unattended. A stall after any
submit also runs `validate-prs <root> --text`, its result for the report
only.

## Report

`reports/spawn-bead-workers/<YYYY-MM-DD>.md`, only once the report-path
check passes (a later run appends `## Run <HH:MM>`), created before the
first dispatch with the preflight, gate and selection readings. Append as
it happens: each submit (PR number), red gate (one-line finding), retry,
label change, kill-switch stop, and the stop and why. Bead ids are allowed
here, never in GitHub text.
