---
name: build-scheduled
description: Use when running `/spawn-bead-workers --scheduled` (the unattended epic build), when reading or writing a `spec:building`, `spec:built`, `spec:stalled` or `build:hold` label, a `## Build state` or `## Build stall` notes block, or the `reports/spawn-bead-workers/` run report, or when another command needs to know which roots the scheduled builder holds.
---

# Build, scheduled

The unattended mode of `/spawn-bead-workers`, modelled on `/plan --scheduled`.
It builds at most one root per run, never waits on a human, and writes a
report. Chain mechanics stay
[`bead-wave-orchestration`](../bead-wave-orchestration/SKILL.md)'s; this
skill adds what goes around them. `build.ts` means
`npx tsx .agents/skills/build-scheduled/scripts/build.ts` (no command:
usage).

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
- **Escalation.** An implementation blocker gets one counted retry with an
  adjusted approach, then leaf escalation and chain truncation as the wave
  skill defines them. Never escalate the root: it goes to `spec:stalled`.
- **Sweep failure no level owns** (a merge conflict between chains):
  `spec:stalled`, finding in the root's notes.
- **Stalling with other chains in flight.** In-flight levels run to their
  verdict and green ones are submitted and recorded; then `spec:stalled`,
  and stop without starting another root.
- **Never merges.** The run ends at PR creation; implementers get the
  canonical `implementer-prompt-template` prompt with nothing appended.

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

Every write to the root is `build.ts write`: it re-reads the root, applies
the write guard, and makes **one** `bd update` with the label flags and
`--append-notes`, every text passed as an argument, never through a shell,
never `--notes`. It computes `firings` from `--firing` (how this firing
ran), so never count firings by hand. Its inputs are files in the session
scratchpad.

- **`spec:building`** is written over `spec:ready` with the first block
  before the first implementer spawns; **`spec:built`** by the completion
  sweep's flow; **`spec:stalled`** on any failure the retries cannot clear.
  Only the maintainer moves a root out of `spec:built` or `spec:stalled`.
- A stall takes `--stall-step`, a closed vocabulary the script checks, and
  the investigator's report as `--stall-file`. No failure text is ever typed
  on a command line. If a stall `write` is refused, report it and stop.

**Kill switch.** Before every level start, every `stack.ts submit` and
every `gh pr edit`, run `still-ours <root>`; `write` applies the same check
to every label write. On exit 1, stop there, write nothing more, and add one
report line.

## Build state

`## Build state` is append-only; readers take the last one outside fenced
text, and a malformed last block stalls the root with no fallback. It is
written with `spec:building`, after each level is submitted, and at every
stop, from the `state` object `build-state` prints, edited
(`write --state-file`).

`build-state <root>` prints `start.action`. On `start`, write the first
block. On `continue`, resume. On `restart`, resume too: the maintainer
moved a stalled root back, so the first block this firing writes carries
`restart: resume`. On `stall`, stall with step `build-state`. There is no
start-over.

## Resume and stop points

Resume follows the wave skill's "Resuming an interrupted run", from the
last block, never the local checkout. On top of it:

1. `validate-prs <root>` before any checkout, push or edit of a recorded
   PR. Exit 1 stalls the root (step `validate-prs`) and touches no PR. This
   includes a `next` branch already on origin: a cut between submit and the
   block write. `sync_first` means run `stack.ts sync` first.
2. `gh stack checkout <pr>` on each chain's `top` PR, each chain in its own
   checkout (`git-workflow/stacking.md` "Worktree mode").
3. Redo each leaf in `redo`: in progress or closed, no submitted level, and
   not escalated (`needs-human`). The only discard is a local reset or
   delete of that chain's `next` branch. A submitted branch is only ever
   reset to `origin/<branch>`, never rewritten. The budget-cut
   `wip: <bead-id> …` commit goes with the discard, so it never reaches a
   submit; if this rule ever keeps branch work, that commit becomes a stall
   on every budget cut.

Never stop between a level's implementer closing its bead and that level's
build-guardian verdict. Before each new level run `still-ours`, then
`gates --queue-only`, then AGENTS.md's Budget Signals bands and
`/clear-backlog`'s run-level stop rule. Start the level only if it can
reach its verdict in the session left. With no `[budget]` signals, go on
level by level. Every stop writes its block, adds its report line and
releases the lock.

## Completion

Once every chain is at `next: done`, run the wave skill's epic completion
sweep over every chain, as attended. A sweep FAIL follows its failure
path; one the retries cannot clear stalls the root (step `sweep`), and so
do a conflicting integration merge and a sweep blocked by a security
finding, the finding in the stall file. On a passing sweep, in order:

1. **Each chain's top PR** gets the completion report at the end of its
   Validation section: verifier names with their verdicts, the number of
   chains and changed files, and the sibling chains' top PRs as `#<n>`
   (none with one chain). Start from the PR's current body (`gh pr view
   <n> --json body`), write it to a file, `pr-text-check` it, run
   `still-ours`, then `gh pr edit <n> --body-file <file>`.
2. **The post-submit check** (below).
3. **`spec:built`**: `write <root> --label spec:built --state-file <file>
   --firing ended`, never the sweep's close step (Overrides).

## Publication guards

Every PR title and body the run writes is composed from structured facts:
the Motivation/Approach/Validation template
(`git-workflow/pull-requests.md`) written for the level from its diff,
verifier names with pass or fail, file counts, and sibling top-PR numbers.
Nothing is copied from bead text, investigator output, verifier findings or
the epic description; findings of any severity stay in the root's notes and
the report ([DEC-016](../../../docs/decisions/dec-016-health-report-disclosure-boundary.md)).
Each text is a scratchpad file; a body goes to `gh` as `--body-file`,
never inline.

`pr-text-check <file|->` rejects what git-workflow keeps out of GitHub
artifacts ("Foundational principle") and internal process text. Publishing
a level, in order:

1. Write its title and body files. Run `pr-text-check` on each, on the
   branch name (`-`, from stdin) and on the level's commit messages
   (`git log --format=%B <base>..HEAD`, base the level below or the trunk).
2. `still-ours`, then `stack.ts submit`.
3. `still-ours`, then `gh pr edit <n>` with the checked title and
   `--body-file`.
4. Write the level's Build state block.

A rejection publishes nothing: the level is held unsubmitted, the report
names it, and the root stalls (step `text-check`, the check's output as
the stall file). History is never amended unattended.

**Security-sensitive levels.** A level whose leaf carries `security` or
`cve-watch`, or was filed from a security finding, gets Approach and
Validation written from its file names only and is held: not submitted,
the root stalled (step `chain <k> level <n> submit`) with a note, and the
maintainer decides how to publish it.

**Post-submit check.** Before `spec:built`, `validate-prs <root> --text`
re-reads every recorded PR and checks its published title, body and
branch as well; exit 1 stalls the root (step `text-check`).

**Never merges.**

Never: run `gh pr merge`, set auto-merge (`enablePullRequestAutoMerge`, `gh pr merge --auto`), run `git push --force`, `gh repo edit` or any `gh api` write; pushing happens only inside `stack.ts submit`.

Nothing in the repo can stop a session whose token may merge from merging.
Stacked PRs cannot be merged from the CLI (`git-workflow/stacking.md`
"Merge ritual"), but a plain PR can. The guarantee rests on two things
outside the code, the scheduler slot's deny list and the canonical
implementer prompt, and enforcing them is the maintainer's responsibility.
Copy [`slot-settings.json`](slot-settings.json) into the slot's Claude Code
settings. It denies merging, `gh repo edit`, direct `git push`
(`stack.ts submit` pushes from its own process) and all of `gh api`: a
permission rule matches a command prefix and cannot tell a read from a
write, and the run's own `gh api` read happens inside `build.ts`. A slot
token with no merge rights is recommended, not required.

## Report

`reports/spawn-bead-workers/<YYYY-MM-DD>.md`, only after the report-path
check passes; a later run that day appends `## Run <HH:MM>`. Create it
before the first dispatch with the preflight and gate readings and the
selection. Append as it happens: a level submitted (PR number), a level
gated red (the investigator's one-line finding), a retry, a label change,
a kill-switch stop, the run stopping and why. Bead ids are allowed here,
never in GitHub text.
