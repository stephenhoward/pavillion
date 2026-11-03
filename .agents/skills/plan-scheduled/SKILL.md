---
name: plan-scheduled
description: Use when running `/plan --scheduled` (the unattended spec pipeline), when reading or writing a `spec:*` label, a `Decisions made for you`, `Advisory Review` or `Planned hierarchy` notes block, or the `reports/spec-plan/` run report, or when another command needs to know which roots the scheduled planner owns.
---

# Plan, scheduled

The unattended mode of `/plan`, modelled on `/clear-backlog --scheduled`. It
never waits on a human: every question the attended command would ask is
answered by best judgement and written on the bead, and every run writes a
report file. `/plan --scheduled` refuses a bead id, `--until`, `--reshape` or
`--readvise`: the selection rules are the whole input, and a hybrid would be
an untested path.

The attended phases in `.agents/commands/plan.md` (DRAFT, ADVISE,
CONFIRM-AND-WRITE, DECOMPOSE, ANALYZE) apply as written, except:

- No AskUserQuestion. Where the attended flow would ask, decide, and record it
  as *Note blocks* says.
- Skip Step 0a, and never list, resume, delete or write drafts under
  `docs/.scratch/`; they may belong to an attended session.
- Skip the CONFIRM-AND-WRITE approval gate and the menu phases
  `### Phase DECOMPOSE prompt` and `### Phase ANALYZE prompt`; the approved
  pass still spawns the `### Phase DECOMPOSE` and `### Phase ANALYZE`
  subagents. The per-run report replaces Step Final.
- Add `advised` only when an advisor ran and none still requests changes
  (agent-discovery: never advance as if review passed).
- Never change a bead's status: `open` is part of every selection, so a
  claimed root would drop out of every later run. Never set `spec:approved`
  or `spec:revise`. Never add `needs-human` or call
  `.agents/tools/bead.ts escalate`; where agent-discovery would escalate a
  persistent REQUEST CHANGES, this mode blocks the root.
- Route on `spec.ts inspect`, never on `bead.ts state` or
  `enrichment-check`: both match "Advisory Review" and "Implementation
  Context" as substrings anywhere in `bd show`, description included.

## Tooling

The deterministic half lives in `scripts/spec.ts`; the passes cite it rather
than restate a query. `spec.ts <command>` below always means the full
`npx tsx .agents/skills/plan-scheduled/scripts/spec.ts <command>` — spell it
out in every call (the Bash tool's zsh does not word-split a `$S` variable,
and shell functions do not survive between calls):

```
select <drafting|approved|revise>   JSON rows: pass candidates, by priority then oldest
inspect <root>                      JSON: status, labels, field presence, last_heading, routing headings
leaves <root>                       JSON rows: leaves still to analyse
last-block <root> "<heading>"       text: body of the last block with that heading; exit 1 if none
revise-note <root>                  text: the maintainer's note, empty if none
revision-number <root>              JSON {revision}: N for the next "(revision N)" blocks
gate-misses <root>                  JSON {misses}: misses since the last restart
state-write <spec:label>            text: the bd update flags of a state write
```

A heading test ("has a Planned hierarchy heading") means `inspect`'s
`headings` field: a markdown heading of any level or case, never a plain
substring. Tests: `npx vitest run --config .agents/tools/vitest.config.ts`.

## Labels

The state vocabulary. A root carries at most one of these after any write
this mode makes; every state write enforces it, clearing a label the
maintainer left behind.

| Label | Meaning | Set by |
|---|---|---|
| `spec:drafted` | Description, design and acceptance written; advisors reviewed (or none applied — then without `advised`). Waiting for the maintainer to approve or revise. | this mode |
| `spec:blocked` | Drafting or revising was refused in whole or part, an advisor still requested changes after one refinement, a revise reached an already-decomposed root, or decomposition missed its gate three times. Waiting for the maintainer, who restarts it by setting a label, never by removing one: `spec:approved` if its notes hold a Planned hierarchy heading (the approved pass resumes it), otherwise `spec:revise` with a note. | this mode |
| `spec:revise` | The maintainer sent the spec back with a note in the notes field. The next run re-drafts it and ends it on an *Outcome labels* row (`spec:drafted`, or `spec:blocked` on a refusal). | maintainer only |
| `spec:approved` | The maintainer approved the spec. The next run decomposes it. | maintainer only |
| `spec:decomposing` | Decomposition or analysis is in progress, or was interrupted. The next run completes it rather than starting over. | this mode |
| `spec:ready` | Every leaf except `decision`-type `Decide:` leaves has an Implementation Context block; for a single-bead root, the root's own notes hold it. An open `Decide:` leaf awaits the maintainer and blocks its dependents. This mode is finished with the root. | this mode |

## Shared rules

- **State write.** A state write to `<target>` is the flags
  `spec.ts state-write <target>` prints, appended to the same `bd update` as the
  fields and notes it accompanies.
- **One call per write.** Each write is **one** `bd update` with its fields,
  notes and labels: a cut before it leaves the next run to redo the step from
  the same input, where split calls could leave an Advisory Review block with
  no `spec:*` label, and that root would drop out of every pass.
- **Files.** Pass every text as `"$(cat <file>)"` from a file in the session
  scratchpad; a heredoc inside `$()` breaks on bash 3.2.
- **Append only.** Notes take `--append-notes`, never `--notes`; never edit an
  earlier block. Readers take the **last** block of each name.
- **Mid-run re-read.** Before every write, `spec.ts inspect` the root. If it is no
  longer `open`, now carries `needs-human`, or lacks the label that selected
  it, someone took it this run: write nothing; report *skipped (taken
  mid-run)*.
- **needs-human.** Every selection flags `needs_human`. Such a root is not
  selected, takes no cap slot, and is reported *skipped (needs-human)*.
- **Design rulings.** Maintainer rulings on design forks, made before
  drafting, live in notes blocks with a Design ruling heading (singular) and
  in a `## Design rulings` description block, kept verbatim. Each is settled:
  never re-ask, contradict or list it under *Decisions made for you*. It also
  settles a *Refuse rather than guess* fork: the maintainer's call in advance.

## Note blocks

Tooling outside this repo parses these two blocks in the root's notes,
whatever their suffix, so their shape is a contract. Nothing else goes under
a *Decisions made for you* heading: status, how a note was addressed and
hierarchy notes go in their own blocks, named below.

**`## Decisions made for you`** holds only questions the attended command
would have put to the maintainer that no design ruling settles, each on one
unwrapped line, refusals first:

```
- **Q:** <question attended mode would have asked> — **A:** <answer> — <why>
- **Q:** <what was asked or attempted> — **A:** refused — <reason>
```

`revise-note` finds a plain-text note by skipping these lines. An empty block
is exactly `none`. Below-the-line choices are ordinary design, in the design
field: implementation details, visuals skipped, how an advisor's condition
was met.

**`## Advisory Review`** has one line per advisor with its **final** verdict
only, in the Phase ADVISE format, and per adjustment a verdict-free line
`- adjusted for <advisor>: <change>`. Consumers scan for `REQUEST CHANGES`,
so it appears only as a final verdict. With no advisor applicable, the block
is `- none applicable — <why>`.

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

## Order of work

Each run takes the **approved pass** (no cap), the **revise pass**, then the
**drafting pass**. The last two share a cap of **2** roots per run; revised
roots run first, so the drafting pass takes `2 − revised-this-run`, which
counts every revise-pass root selected, refused or *skipped (taken mid-run)*
included. The rest are *not taken (cap)*.

## Approved pass

Takes every root of `spec.ts select approved` to `spec:ready`, in the printed
order.

**Route.** Re-read each root before starting (*Mid-run re-read*: it must
still carry `spec:approved` or `spec:decomposing`). Skip and report one whose
row says `also_revise`; the revise pass takes it. Otherwise:

| Root | Path |
|---|---|
| has a Planned hierarchy heading | **Resume**, after a state write to `spec:decomposing` if it lacks that label; planning again would duplicate children |
| anything else | **Plan** |

**Decomposition rules.** These bind the Plan step and the DECOMPOSE subagent,
and win over `decompose-bead.md`, its Phase 3 three-level patterns and
"SCOPE TBD" children included.

1. At most two levels: every new bead's parent is the root, with no container
   or "SCOPE TBD" children. Every leaf meets decompose-bead.md's leaf
   criteria and is completable by one agent.
2. No prose gates. A gate is a `bd dep add` on a bead in this repo, or a
   defer date, or it is dropped. A blocker is never only a note.
3. No open design forks in a leaf. Use a design ruling that covers the fork;
   otherwise pick the option and record why in the leaf's design field. An
   unruled fork on the *Refuse rather than guess* list is not picked: it
   becomes its own leaf, created with `--type decision` and titled
   `Decide: <question>`, whose description names the maintainer as decider
   and lists the options, and every leaf it gates gets a `bd dep add` on it.
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

**Plan.** For a root routed here:

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

**Resume.** Read `spec.ts last-block <id> "Planned hierarchy"` and
`bd children <id> --json`; do not re-plan. Go to **Analyze** if the block is
the `- none` line or every row's title matches a child of its Parent, else to
**Decompose**.

**Decompose.** Spawn the subagent with the prompt under `### Phase DECOMPOSE`,
followed by:

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

**Analyze.** *Single-bead root* (the `- none` line): with an Implementation
Context heading, go to the gate. Otherwise spawn the `### Phase ANALYZE`
prompt with its Phase 1.5 sentence ("The bead already has children. Skip
Phase 1.5 … Start from Phase 2") replaced by *"Skip Phase 1.5. Use
analysis_mode = single and go to Phase 4b."*, then go to the gate.

*Decomposed root*: `spec.ts leaves <id>` lists the leaves still to analyse
(`decision`-type leaves excluded: only the maintainer resolves them). If it
prints `[]`, go to the gate. Otherwise spawn the subagent with the prompt
under `### Phase ANALYZE`, followed by:

> Scheduled mode. Analyse only these leaves: <ids from `leaves`>. Never ask;
> flag issues in the report. Verify that every file path a leaf cites exists,
> and correct it in the Implementation Context if it has moved. Do not append
> a second Implementation Context block to a leaf that already has one. If
> the root's notes already hold a `# Bead Analysis` heading, skip Phase 5a.

**Gate to `spec:ready`.** A single-bead root passes when it has an
Implementation Context heading; a decomposed root, when every row of the last
Planned hierarchy block matches a child of its Parent by title and `leaves`,
re-run, prints `[]`. On a pass, make a state write to `spec:ready`. The
ANALYZE subagent's Phase 5a normally appends `# Bead Analysis` to the root
itself; only if the root still has no Bead Analysis heading and the subagent
returned an execution-wave summary this run, append it under
`# Bead Analysis` in the same call — otherwise append nothing, as a second
block would duplicate it.

On a miss the root stays `spec:decomposing` for the next run. Read
`spec.ts gate-misses <id>`, then in one call append
`- gate not met <YYYY-MM-DD>: <what remains>`, preceded by a
`## Decomposition gate` heading unless `inspect`'s `last_heading` is already
`## Decomposition gate`, so a miss line never falls inside another block. If `misses` was
2 or more, this is the third: the same call appends
`## Decisions made for you (decomposition gate)` with
`- **Q:** Finish decomposing this root? — **A:** stopped — <what never completed>`
and makes a state write to `spec:blocked`.

The Planned hierarchy block makes a cut run safe: every later step is
idempotent (the title lookup reuses children, `leaves` skips analysed ones),
so the next run completes the root rather than duplicating it.

## Revise pass

Re-drafts roots sent back with `spec:revise` as `--reshape` does, re-advises
them as `--readvise` does, under the drafting pass's rules, and ends each on
a row of *Outcome labels*. Roots are `spec.ts select revise`, in the printed order.

**0. Check it was only drafted.** `spec.ts inspect <id>` is this step's
read and the *Mid-run re-read* for the refusals below. A root with a Planned
hierarchy heading has been through the approved pass; re-drafting would leave its children or
Implementation Context describing a different spec. Refuse it: number the
revision (step 2) and, in one call, append only a
`## Decisions made for you (revision N)` block whose first item is
`- **Q:** Re-draft this root? — **A:** refused — it was already decomposed; edit its leaves by hand, keeping their titles, then set spec:approved to resume`,
with a state write to `spec:blocked`.

**1. Read the note.** `spec.ts revise-note <id>` prints it: the body of a dated
`revision (<YYYY-MM-DD>)` heading the maintainer's tooling wrote after the
last Decisions block, or else plain text appended by `bd note` after that
block's items. Either runs to the next heading, so a note may not contain
headings of its own, and a following Design ruling block is never the note.
If it prints nothing, a re-draft would be a guess: refuse as in step 0, with
`- **Q:** Re-draft this root? — **A:** refused — spec:revise with no note after the last Decisions block`.

**2. Number the revision.** `spec.ts revision-number <id>`: 1 + the count of
`Decisions made for you (revision K)` headings, not Advisory Review ones,
which a refused revision does not write.

**3. Re-draft** only the fields the note affects, as `--reshape` re-runs
DRAFT, holding each in context until step 5. Every drafting-pass rule
applies: the overrides, *Refuse rather than guess*, and the author's
reasoning kept verbatim without a second opening paragraph. A design ruling
appended after the last Decisions block is newer than the spec: apply it. A
note asking for a change on the refuse list is refused; where it can be
partly addressed without that change, do that part and refuse the rest; the
done part is still re-advised in step 4, which overrides the drafting pass's
skip-ADVISE-on-refusal rule.

**4. Re-advise** as `--readvise` re-runs ADVISE: the drafting pass's
**Advise** step, with the whole revised plan given to every matched advisor.
Skip it only when step 3 re-drafted no field.

**5. Write.** Re-read the root (*Mid-run re-read*: it must still carry
`spec:revise`), then write with the drafting pass's **Write** call and file
layout, with only the re-drafted fields, and
`F=<session-scratchpad>/<id>-rev<N>`. The notes file holds, in order:
`## Advisory Review (revision N)` (omitted when no field was re-drafted);
`## Revision notes (revision N)`, saying how the note was addressed, what was
not, and why; then `## Decisions made for you (revision N)`, holding only
refusals and open questions per *Note blocks*, or `none`. Read back with
`bd show <id> --json | jq -r '.[0].notes'`: the new blocks follow every
earlier one, unchanged.

## Drafting pass

**Select.** `spec.ts select drafting` lists the candidates: open `office:*` roots
carrying no `spec:*` label and no Advisory Review heading, none of whose
children is `in_progress` or `closed` (started children mean shipped work;
all-open children are author-written, part of the brief). Take as many rows
not flagged `needs_human` as *Order of work* leaves. The rule lives in
`selectDrafting` in `scripts/lib/spec.ts`; amend it there and nowhere else.

**Draft.** Treat the bead's existing description as the brief. Keep it
verbatim, open it with a short plain-language paragraph, and extend it with
scope and success criteria; do not replace the author's reasoning. Read any
children (`bd children <id>`) as part of the brief: the design accounts for
them, but does not restructure them. As in attended DRAFT, skip a sub-step
whose field is populated, except the description. Sub-step 1 is answered
from the brief; sub-step 2 (visuals) is skipped, and the design says so;
sub-steps 3–7 run as written.

**Refuse rather than guess** when drafting would require any of these, unless
a design ruling settles it:

- changing a public URL or slug shape: anything that changes
  `src/common/routing/public-paths.ts`, `src/common/routing/reserved-segments.ts`,
  `src/site/routes.ts`, or calendar or series url-name rules (DEC-018);
- changing federation semantics: which activities are emitted or accepted,
  their type, addressing or object shape, actor-document properties, or inbox
  and outbox trust rules (DEC-013, DEC-014, DEC-015 *federated report routing*);
- a destructive data migration: dropping or renaming a column or table, or
  deleting or irreversibly rewriting rows;
- contradicting, amending or superseding a decision in `docs/decisions/` whose
  Status is Accepted, or any still-in-force clause of a decision, whatever its
  file's Status, such as adopting an ActivityPub library (DEC-012) or `@` in
  public URLs (DEC-006). Decision text has override priority, so changing one
  is the product owner's call. Proposing a brand-new DEC is not a refusal;
  record it under *Decisions made for you*.

On a refusal, write whatever fields are complete, skip ADVISE (an Advisory
Review block would make the bead read as advised), make the refusal the first
*Decisions made for you* item, and end on the refusal row.

**Advise.** Run Phase ADVISE as written — same discovery
(`npx tsx .agents/skills/agent-discovery/scripts/agents.ts advisor`), same
single Task batch, same plan template — except:

- On APPROVE WITH CONDITIONS or REQUEST CHANGES, adjust the draft yourself,
  re-run only the affected advisors once, and add an `- adjusted for` line.
- If no advisor plausibly applies, proceed without `advised`.
- If REQUEST CHANGES survives the single refinement, still write the fields
  and both blocks, end on that row, and stop on that root.

**Write.** Re-read the root (*Mid-run re-read*: it must carry no `spec:*`
label), then write what CONFIRM-AND-WRITE writes, unprompted, in one call
with the *Outcome labels*, dropping the flag of any field not written:

```bash
F=<session-scratchpad>/<id>
bd update <id> --description "$(cat $F-description.md)" \
  --design "$(cat $F-design.md)" --acceptance "$(cat $F-acceptance.md)" \
  --append-notes "$(cat $F-notes.md)" \
  --add-label shaped --add-label advised \
  $(npx tsx .agents/skills/plan-scheduled/scripts/spec.ts state-write spec:drafted)
```

The notes file holds references, applicable standards, `## Advisory Review`
(omitted on a refusal) and `## Decisions made for you`, in that order. A cut
before the write leaves the root as the bead's author left it, so the next
run drafts from the original brief without doubling the opening paragraph.
Read back with `bd show <id>` and run the CONFIRM-AND-WRITE checklist. Stop
there: **no decomposition and no analysis in this pass**, and no children
created.

## Per-run report

Write `reports/spec-plan/<YYYY-MM-DD>.md` (`$(date +%F)`) in the workspace
(`reports/` is gitignored — verify with `git check-ignore`, and add the
pattern if missing), appending a `## Run <HH:MM>` section if it exists.
Contents:

- each root touched: id, title, pass, resulting label, advisor verdict lines,
  count of decisions made, and any refusals or errors
- each revise-pass root: revision number, and whether the note was fully
  addressed
- each approved-pass root: its leaf count (`1 (the root)` for a single-bead
  root), or the leaves still unanalysed if it stays `spec:decomposing`; each
  `Decide:` leaf it created, for the maintainer to decide; and whether the
  gate bound blocked it, with what never completed
- the roots *skipped (taken mid-run)*, *skipped (needs-human)*, or skipped by
  the approved pass for also carrying `spec:revise`; and those
  **not taken (cap)**, with priority and title

The report is local and gitignored, so bead IDs are allowed there — they
remain forbidden in branches, commits, and PRs.
