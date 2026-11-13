# Labels and note blocks

The state vocabulary and the notes contract every pass writes against. Read
this when setting, clearing or interpreting a `spec:*` label, or when writing
or parsing a `Decisions made for you` or `Advisory Review` block.

## Labels

A root carries at most one `spec:*` label after any write this mode makes;
every state write enforces it, clearing a label the maintainer left behind.
The planner writes through `spec.ts state-write <label>`. The build labels
are written only through `build.ts write`, which also checks the run's lock,
the kill switch and the notes block; `build.ts state-write` only prints the
flags for inspection and is never a write path. The table is shared: `/plan --scheduled` owns the first six rows,
`/spawn-bead-workers --scheduled` (the
[`build-scheduled`](../build-scheduled/SKILL.md) skill) owns the three build
rows, and each script accepts only its own labels as a write target.

| Label | Meaning | Set by |
|---|---|---|
| `spec:drafted` | Description, design and acceptance written; advisors reviewed (or none applied — then without `advised`). Waiting for the maintainer to approve or revise. | this mode |
| `spec:blocked` | Drafting or revising was refused in whole or part, an advisor still requested changes after one refinement, a revise reached an already-decomposed root, or decomposition missed its gate three times. Waiting for the maintainer, who restarts it by setting a label, never by removing one: `spec:approved` if its notes hold a Planned hierarchy heading (the approved pass resumes it), otherwise `spec:revise` with a note. | this mode |
| `spec:revise` | The maintainer sent the spec back with a note in the notes field. The next run re-drafts it and ends it on an *Outcome labels* row (`spec:drafted`, or `spec:blocked` on a refusal). | maintainer only |
| `spec:approved` | The maintainer approved the spec. The next run decomposes it. | maintainer only |
| `spec:decomposing` | Decomposition or analysis is in progress, or was interrupted. The next run completes it rather than starting over. | this mode |
| `spec:ready` | Every leaf except `decision`-type `Decide:` leaves has an Implementation Context block; for a single-bead root, the root's own notes hold it. An open `Decide:` leaf awaits the maintainer and blocks its dependents. This mode is finished with the root. | this mode |
| `spec:building` | A scheduled build is under way or was cut between firings; the next scheduled build resumes it. | build-scheduled |
| `spec:built` | Every chain's levels are submitted and the sweep passed. Waiting for the maintainer to merge, then close the root. | build-scheduled |
| `spec:stalled` | The build hit a failure its retries could not clear. Waiting for the maintainer, who resumes it by setting `spec:building`. | build-scheduled |

`build:hold` is not a state label and no state write removes it: the
maintainer sets it to keep a root out of scheduled builds, and only the
maintainer removes it. The `## Build state` and `## Build stall` note blocks
the build labels travel with are written and parsed only by
[`build-scheduled`](../build-scheduled/SKILL.md)'s script
(`formatBuildState`, `formatStallBlock` and `parseBuildState` in
`scripts/lib/build.ts`); `build.ts build-state <root>` prints a root's last
block as JSON.

## Outcome labels

The drafting and revise passes end each root on one row:

| Outcome | Labels |
|---|---|
| advisors ran, none still requests changes | `shaped`, `advised`, state write `spec:drafted` |
| no advisor plausibly applies | `shaped`, state write `spec:drafted` |
| REQUEST CHANGES persisted after the refinement | `shaped`, state write `spec:blocked` |
| any refusal, whole or partial | `shaped`, state write `spec:blocked` |

Drop `shaped` while description, design or acceptance is empty, and end on
`spec:blocked` (as a refusal) rather than `spec:drafted` if any of the three
is still empty. In the revise pass a row without `advised` adds
`--remove-label advised` only when a field was re-drafted: the label
describes the current spec, and a refusal that changes nothing leaves the
reviewed spec in place.

## Note blocks

Tooling outside this repo parses these two blocks in the root's notes,
whatever their suffix, so their shape is a contract. Nothing else goes under
a *Decisions made for you* heading: status, how a note was addressed and
hierarchy notes go in their own blocks (`## Revision notes`,
`## Decomposition notes`, `## Decomposition gate`).

**`## Decisions made for you`** holds only questions the attended command
would have put to the maintainer that no design ruling settles, each on one
unwrapped line, refusals first:

```
- **Q:** <question attended mode would have asked> — **A:** <answer> — <why>
- **Q:** <what was asked or attempted> — **A:** refused — <reason>
```

`spec.ts revise-note` finds a plain-text note by skipping these lines. An
empty block is exactly `none`. Below-the-line choices are ordinary design, in
the design field: implementation details, visuals skipped, how an advisor's
condition was met.

**`## Advisory Review`** has one line per advisor with its **final** verdict
only, in the Phase ADVISE format, and per adjustment a verdict-free line
`- adjusted for <advisor>: <change>`. Consumers scan for `REQUEST CHANGES`,
so it appears only as a final verdict. With no advisor applicable, the block
is `- none applicable — <why>`.

**Design rulings.** Maintainer rulings on design forks, made before drafting,
live in notes blocks with a Design ruling heading (singular) and in a
`## Design rulings` description block, kept verbatim. Each is settled: never
re-ask, contradict or list it under *Decisions made for you*. It also settles
a *Refuse rather than guess* fork (drafting-pass.md): the maintainer's call
in advance.
