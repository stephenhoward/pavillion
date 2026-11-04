# Approved pass

Takes every root of `spec.ts select approved` (open roots carrying
`spec:approved` or `spec:decomposing`) to `spec:ready`, in the printed order,
with no cap. Labels and the state write are defined in labels-and-blocks.md;
the write discipline (one call, append only, mid-run re-read) is in SKILL.md.

## Route

Re-read each root before starting (*Mid-run re-read*: it must still carry
`spec:approved` or `spec:decomposing`). Skip and report one whose row says
`also_revise`; the revise pass takes it. Otherwise:

| Root | Path |
|---|---|
| has a Planned hierarchy heading | **Resume**, after a state write to `spec:decomposing` if it lacks that label; planning again would duplicate children |
| anything else | **Plan** |

## Decomposition rules

These bind the Plan step and the DECOMPOSE subagent, and win over
`decompose-bead.md`, its Phase 3 three-level patterns and "SCOPE TBD"
children included.

1. At most two levels: every new bead's parent is the root, with no container
   or "SCOPE TBD" children. Every leaf meets decompose-bead.md's leaf
   criteria and is completable by one agent.
2. No prose gates. A gate is a `bd dep add` on a bead in this repo, or a
   defer date, or it is dropped. A blocker is never only a note.
3. No open design forks in a leaf. Use a design ruling that covers the fork;
   otherwise pick the option and record why in the leaf's design field. An
   unruled fork on the *Refuse rather than guess* list (drafting-pass.md) is
   not picked: it becomes its own leaf, created with `--type decision` and
   titled `Decide: <question>`, whose description names the maintainer as
   decider and lists the options, and every leaf it gates gets a
   `bd dep add` on it.
4. Leaves cite files by path as of decomposition; analysis re-verifies each
   path exists before writing Implementation Context.
5. Children that already exist were written by the bead's author. Adopt them
   as the starting hierarchy, create nothing that duplicates one's scope, and
   add siblings under the root for scope nothing covers. You may update an
   existing child's description, design and acceptance to agree with the
   approved design, but not its title; never close or delete one, and record
   a redundant one in the Decomposition notes block. One with children of its
   own is adopted as it stands, recorded there too: Type `container` in the
   block, and a row per child whose Parent is that child.
6. An oversized existing child is narrowed, not split: shrink its description
   to one leaf's worth, add sibling leaves under the root for the rest, and
   record it in the Decomposition notes block. Grandchildren would make it a
   container, which rule 1 forbids: containers never close, and the sweep
   skips them.

## Plan

For a root routed here:

1. Run `npx tsx .agents/skills/bead-state-assessment/scripts/bead.ts sizing-check <id>`
   and `bd children <id> --json`. It is a **single-bead root** when
   `needs_decomposition` is false and it has no children. A root with
   children is decomposed whatever the sizing check says.
2. Plan the hierarchy yourself, not in a subagent: decompose-bead.md
   Phases 2–3 under the decomposition rules. Write to
   `<session-scratchpad>/<id>-hierarchy.md`:

   ```
   ## Planned hierarchy

   | Title | Type | Parent | Depends on | Existing id |
   |---|---|---|---|---|
   | <exact title> | task, or decision (rule 3) | <root-id> | <titles or ids, or —> | <id, or new> |
   ```

   One row per leaf, existing children included by current title and id. For
   a single-bead root the table is the line
   `- none: sizing-check needs_decomposition=false; analysed as a single bead`,
   so Resume always reads a block. Below it in the same file goes
   `## Decomposition notes`: the hierarchy shape chosen, and what rules 5 and
   6 record. It is design, not a *Decisions made for you* block.
3. Before any subagent runs, in one call, append the file and make a state
   write to `spec:decomposing`, so a cut subagent never leaves children
   without a recorded plan.
4. Go to **Decompose**; for a single-bead root, to **Analyze**.

## Resume

Read `spec.ts last-block <id> "Planned hierarchy"` and
`bd children <id> --json`; do not re-plan. Go to **Analyze** if the block is
the `- none` line or every row's title matches a child of its Parent, else to
**Decompose**.

## Decompose

Spawn the subagent with the prompt under `### Phase DECOMPOSE` in
`.agents/commands/plan.md`, followed by:

> Scheduled mode. Phase 3 is satisfied by the root's last `## Planned
> hierarchy` block. Create exactly what it lists, then run Phases 4–8. Never
> ask; decide, and report the decision. Every new row is a leaf: create it
> with the Phase 6 template under the Parent its row names. Phase 5 creates
> nothing. Before each `bd create`, check for an exact title match under the
> parent, and reuse its id if one exists:
> `bd children <parent> --json | jq -r --arg t "<title>" '.[] | select(.title == $t) | .id'`.
> Phase 7 adds the block's *Depends on* column as `bd dep add`, resolving each
> title to an id with the same lookup, and adding no dependency that already
> exists. The rules below override decompose-bead.md wherever they conflict,
> including its three-level patterns and its "SCOPE TBD" children:
> <the six decomposition rules above, verbatim>.

## Analyze

*Single-bead root* (the `- none` line): with an Implementation Context
heading, go to the gate. Otherwise spawn the `### Phase ANALYZE` prompt from
`.agents/commands/plan.md` with its Phase 1.5 sentence ("The bead already
has children. Skip Phase 1.5 … Start from Phase 2") replaced by *"Skip
Phase 1.5. Use analysis_mode = single and go to Phase 4b."*, then go to the
gate.

*Decomposed root*: `spec.ts leaves <id>` lists the leaves still to analyse
(`decision`-type leaves excluded: only the maintainer resolves them). If it
prints `[]`, go to the gate. Otherwise spawn the subagent with the prompt
under `### Phase ANALYZE`, followed by:

> Scheduled mode. Analyse only these leaves: <ids from `leaves`>. Never ask;
> flag issues in the report. Verify that every file path a leaf cites exists,
> and correct it in the Implementation Context if it has moved. Do not append
> a second Implementation Context block to a leaf that already has one. If
> the root's notes already hold a `# Bead Analysis` heading, skip Phase 5a.

## Gate to `spec:ready`

A single-bead root passes when it has an Implementation Context heading; a
decomposed root, when every row of the last Planned hierarchy block matches a
child of its Parent by title and `leaves`, re-run, prints `[]`. On a pass,
make a state write to `spec:ready`. The ANALYZE subagent's Phase 5a normally
appends `# Bead Analysis` to the root itself; only if the root still has no
Bead Analysis heading and the subagent returned an execution-wave summary
this run, append it under `# Bead Analysis` in the same call — otherwise
append nothing, as a second block would duplicate it.

On a miss the root stays `spec:decomposing` for the next run. Read
`spec.ts gate-misses <id>`, then in one call append
`- gate not met <YYYY-MM-DD>: <what remains>`, preceded by a
`## Decomposition gate` heading unless `inspect`'s `last_heading` is already
`## Decomposition gate`, so a miss line never falls inside another block. If
`misses` was 2 or more, this is the third: the same call appends
`## Decisions made for you (decomposition gate)` with
`- **Q:** Finish decomposing this root? — **A:** stopped — <what never completed>`
and makes a state write to `spec:blocked`.

The Planned hierarchy block makes a cut run safe: every later step is
idempotent (the title lookup reuses children, `leaves` skips analysed ones),
so the next run completes the root rather than duplicating it.

## Report lines

For report.md: the leaf count (`1 (the root)` for a single-bead root), or the
leaves still unanalysed if the root stays `spec:decomposing`; each `Decide:`
leaf created, for the maintainer to decide; whether the gate bound blocked
it, with what never completed; and roots skipped for also carrying
`spec:revise`.
