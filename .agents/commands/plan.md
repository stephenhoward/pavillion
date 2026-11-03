# Plan

Single state-routed entry point for taking work from idea → ready-for-implementation. Replaces the deprecated `/shape-spec`, `/shape-bead`, and `/decompose-spec`.

## Usage

```
/plan                          # blank slate: draft → advise → ask about decompose
/plan pv-xxxx                  # resume bead at whatever state it's in
/plan --until shaped           # stop after fields written (skip advisors)
/plan --until advised          # advisors then stop (default for shaped beads)
/plan --until decomposed       # advise → decompose, stop before analyze
/plan --until analyzed         # full pipeline to ready-for-spawn
/plan pv-xxxx --reshape        # force re-run of DRAFT phase
/plan pv-xxxx --readvise       # force re-run of ADVISE phase
/plan --scheduled              # unattended: approved, revise, drafting passes; see "Scheduled mode"
```

## Important Guidelines

- **Always use AskUserQuestion tool** when asking the user anything
- **Detect state first** — Read `bd show <id>` (if a bead exists) and use the `bead-state-assessment` skill to determine what phase to start at
- **Offer suggestions** — Present options the user can confirm, adjust, or correct
- **Keep it lightweight** — This is planning, not exhaustive documentation
- **Output to bead** — All durable content writes to bead fields, not committed spec folders
- **Use the scratchpad as a review surface** — A spec scratchpad under `docs/.scratch/` (gitignored) holds the full plan for human review before it lands on the bead. After the bead is written, the scratchpad is deleted.
- **`--scheduled` overrides the AskUserQuestion and scratchpad rules above** — see "Scheduled mode"

## Phases

`/plan` orchestrates five discrete phases. State detection picks the entry phase; `--until` picks the exit phase.

| Phase | Output | Default exit |
|---|---|---|
| DRAFT | Fields populated in scratchpad `draft.md` | (continues to ADVISE) |
| ADVISE | Advisor verdicts appended to scratchpad | (continues to CONFIRM-AND-WRITE) |
| CONFIRM-AND-WRITE | Bead fields written, labels added, scratchpad deleted | `advised` |
| DECOMPOSE | Bead has CHILDREN | `decomposed` |
| ANALYZE | Each leaf has Implementation Context | `analyzed` |

## Process

### Step 0: Resolve State and Entry Point

If a bead ID was provided:

```bash
bd show <bead-id>
```

Determine state via the `bead-state-assessment` skill:

- `unshaped` → entry phase: **DRAFT**
- `shaped` → entry phase: **ADVISE** (skip DRAFT unless `--reshape`)
- `advised` → entry phase: **DECOMPOSE prompt** (skip ADVISE unless `--readvise`)
- `decomposed` → entry phase: **ANALYZE prompt**
- `analyzed` → already ready; report and exit
- `executing` / `complete` → refuse with a message

If no bead ID was provided, start at DRAFT and create the bead during CONFIRM-AND-WRITE.

### Step 0a: Scratchpad Probe

Before starting any phase, check `docs/.scratch/` for in-flight drafts:

```bash
ls -1 docs/.scratch/ 2>/dev/null
```

If any exist, use AskUserQuestion:

```
Found in-flight plan drafts:
- <timestamp>-<slug> (last touched <date>)
- ...

What should I do?
1. Resume <most-recent>
2. Discard all and start fresh
3. Cancel
```

### Phase DRAFT

**Skip** the substeps individually if the corresponding bead field is already populated (unless `--reshape` was passed).

Create scratchpad:

```bash
mkdir -p docs/.scratch/<timestamp>-<slug>
```

Then walk:

1. **Clarify scope** — what we're building, in/out of scope, user stories, success criteria
2. **Visuals** — mockups, screenshots, references
3. **Reference implementations** — similar code in this codebase
4. **Product context** — read `docs/decisions.md`; check alignment
5. **Standards** — read `.agents/skills/standards-routing/index.yml`; confirm applicable ones
6. **Technical design** — approach, key files, patterns, integration points
7. **Acceptance criteria** — testable checklist

Write the full plan to `docs/.scratch/<timestamp>-<slug>/draft.md` as a single readable document with sections for each field that will land on the bead.

**Exit condition for `--until shaped`:** if the user requested to stop after fields are written but before advisors, proceed straight to CONFIRM-AND-WRITE without running ADVISE.

### Phase ADVISE

Pick advisors via the [`agent-discovery`](../skills/agent-discovery/SKILL.md) skill: enumerate candidates with `npx tsx .agents/skills/agent-discovery/scripts/agents.ts advisor`, then select the applicable subset yourself using the drafted plan (Key Files, scope, concerns) against each candidate's description — default toward inclusion, per the skill. If no advisor plausibly applies, ask the user whether to proceed without advisory review or revisit the design.

Spawn every matched advisor **in a single Task tool batch**. Provide the full plan inline using this template, adapted per advisor:

> Review this implementation plan for [advisor's focus area]. The plan is fully formed but no code has been written yet.
>
> **Feature:** [scope summary]
> **Product Context:** [alignment notes]
> **Applicable Standards:** [list]
> **Reference Implementations:** [patterns identified]
> **Technical Design:** [design]
> **Acceptance Criteria:** [list]
>
> Adapt your normal review process to work with an implementation plan rather than a completed spec.

Apply the [`review-mode-advisor`](../skills/review-mode-advisor/SKILL.md) verdict protocol exactly as documented in agent-discovery's "Verdict interpretation" section:

- **All APPROVE** — Note "Advisory review passed — no concerns flagged" and proceed to CONFIRM-AND-WRITE.
- **APPROVE WITH CONDITIONS or REQUEST CHANGES** — Surface concerns via AskUserQuestion; agree adjustments; revise the relevant draft fields; **re-run only the affected advisors once** with the revised plan.
- **REQUEST CHANGES still present after that single refinement** — Escalate to the user and stop before writing to the bead.

Append every advisor's verdict to `docs/.scratch/<timestamp>-<slug>/advisor-notes.md` with this format:

```
- **<advisor-name>:** APPROVE | APPROVE WITH CONDITIONS | REQUEST CHANGES — <one-line summary>
```

The `advised` label is applied during CONFIRM-AND-WRITE, not here.

### Phase CONFIRM-AND-WRITE

Before any `bd create` or `bd update` call, present the proposed artifact for explicit approval using AskUserQuestion. This is the final gate — once approved, the bead lands.

Show the user a summary that includes the scratchpad path so they can open the full plan:

```
About to write to bead [<id> | new bead] with the following:

**Title:** [title]
**Description (summary):** [one-paragraph synopsis]
**Design — Key Files:** [list]
**Acceptance:** [count] criteria
**Notes to append:** [references / standards / visuals / advisory verdicts]
**Labels:** [+shaped] [+advised if ADVISE ran]

Full plan: docs/.scratch/<timestamp>-<slug>/draft.md

Approve and write?
```

Options:
1. **Approve and write** — proceed below
2. **Revise** — say which field(s) to adjust; loop back to the relevant DRAFT substep, then return here

On approval:

```bash
# Create bead if needed
bd create --title="[Feature Title]" --type=task --priority=2 --silent
# Capture the bead ID

# Separate update per field
bd update <id> --description="<from scratchpad>"
bd update <id> --design="<from scratchpad>"
bd update <id> --acceptance="<from scratchpad>"
bd update <id> --append-notes="<references + standards + Advisory Review section>"

# Apply labels
bd update <id> --add-label shaped
# Only add `advised` if the ADVISE phase ran in this invocation
bd update <id> --add-label advised
```

Read back to verify:

```bash
bd show <id>
```

Check:
- [ ] Description has overview, scope, and success criteria
- [ ] Design has approach, patterns, and key files
- [ ] Acceptance has testable checklist
- [ ] Notes contain references and (if ADVISE ran) Advisory Review section
- [ ] `shaped` label present
- [ ] `advised` label present (if ADVISE ran)

Delete the scratchpad:

```bash
rm -rf docs/.scratch/<timestamp>-<slug>/
```

**Exit condition for `--until shaped` or `--until advised`:** stop here.

### Phase DECOMPOSE prompt

If `--until shaped` or `--until advised` was passed, do not prompt. Otherwise:

```
Bead <id> is at state `<advised|shaped>`.

1. Decompose now — break into epic hierarchy via subagent (recommended for multi-file features)
2. Stop here — this bead is small enough to implement directly
```

**Default recommendation:** Recommend "decompose" if the design mentions 4+ files or spans backend + frontend. Recommend "stop" otherwise.

If the user chooses **"Stop here"** or `--until advised` was set, present a summary and exit:

```
Bead <id> is ready for direct implementation.

### Fields Populated
- **Description:** ...
- **Design:** ...
- **Acceptance:** ...

### Next Step
bd update <id> --status=in_progress
```

### Phase DECOMPOSE

Use the Task tool to spawn a general-purpose subagent:

> Read `.agents/commands/decompose-bead.md` and follow its full process for bead `<bead-id>`.
>
> The bead is already shaped and advised. Start from Phase 2 (Analyze Content) since Phase 1 (Read and Validate) is already satisfied.
>
> **Autonomous mode:** Make best-guess decisions about hierarchy structure. Only ask if a work area is genuinely ambiguous. Prefer action over questions.
>
> When done, report the hierarchy structure and list of ready beads.

Wait for the subagent to complete. Capture the epic ID and hierarchy from its output.

### Phase ANALYZE prompt

If `--until decomposed` was passed, do not prompt. Otherwise:

```
Bead <id> is decomposed into <count> children.

1. Analyze now — enrich leaves with implementation context via subagent
2. Stop here
```

### Phase ANALYZE

Use the Task tool to spawn a general-purpose subagent:

> Read `.agents/commands/analyze-bead.md` and follow its full process for bead `<epic-id>`.
>
> The bead already has children. Skip Phase 1.5 (Assess Structure & Decomposition Need) — children are confirmed to exist. Start from Phase 2 (Map the Hierarchy).
>
> **Autonomous mode:** Proceed through all leaves without pausing. Flag any issues in the completion report rather than stopping to ask.
>
> When done, report the execution waves and confirm all leaves have implementation context in their notes.

Wait for completion. Capture the execution waves summary.

### Step Final: Report

```
## Plan Complete

**Bead:** <id> — [Title]
**Final state:** advised | decomposed | analyzed

### Hierarchy (if decomposed)
[from decompose subagent output]

### Execution Waves (if analyzed)
[from analyze subagent output]

### Ready to Start
[next step — direct implementation, or /spawn-bead-workers <epic-id>]
```

## Bead Field Mapping

| Bead Field | Content |
|-----------|---------|
| `description` | What, why, in/out of scope, user stories, success criteria |
| `design` | How — approach, patterns, files, decisions |
| `acceptance` | Testable done checklist |
| `notes` | Context: references, applicable standards, visuals, Advisory Review |
| `shaped` label | Description + design + acceptance are populated |
| `advised` label | Advisors have reviewed and signed off |

## Scheduled mode (`--scheduled`)

Unattended run, modelled on `/clear-backlog --scheduled`. It asks no questions
and never waits on a human: every question the attended command would have
asked is answered by best judgement and written down on the bead, and every
run writes a report file. `--scheduled` takes no bead id and no other flag;
refuse `--scheduled` combined with a bead id, `--until`, `--reshape` or
`--readvise`. The selection rule is the whole input, and a hybrid would be an
untested path.

**Overrides of the attended flow.** The phases above apply as written, except:

- No AskUserQuestion anywhere. Where the attended flow would ask, decide, and
  record the question and the answer under *Decisions made for you*.
- Skip Step 0a. Never list, resume or delete drafts under `docs/.scratch/`;
  they may belong to an attended session.
- Write no scratchpad under `docs/.scratch/`. Hold the draft in context; any
  file a `bd` call needs goes in the session scratchpad.
- Skip the CONFIRM-AND-WRITE approval gate and the two menu phases,
  `### Phase DECOMPOSE prompt` and `### Phase ANALYZE prompt`. The approved
  pass still spawns the subagents defined under `### Phase DECOMPOSE` and
  `### Phase ANALYZE`. Step Final is replaced by the per-run report.
- Add `advised` only when at least one advisor ran and none still requests
  changes. When no advisor plausibly applies, the root is still
  `spec:drafted`, but without `advised` (agent-discovery: never advance as if
  review passed).
- Never change a bead's status. Status `open` is part of the selection rule,
  so a claimed root would drop out of every later run.
- Never set `spec:approved` or `spec:revise`.
- Never add `needs-human` and never call `.agents/tools/bead.ts escalate`.
  Where agent-discovery would escalate after a persistent REQUEST CHANGES, this
  mode labels the root `spec:blocked` instead.
- Do not route on `bead-state-assessment`'s `bead.ts state` or
  `enrichment-check`. Both match "Advisory Review" and "Implementation
  Context" as substrings anywhere in `bd show` output, description included,
  so they misclassify beads whose prose mentions the phrases. Test notes
  headings with the `jq` filters in this section instead.

### Labels

This table is the canonical state vocabulary; the passes below refer to it
rather than restating it.

| Label | Meaning | Set by |
|---|---|---|
| `spec:drafted` | Description, design and acceptance written; advisors reviewed (or none applied — then without `advised`). Waiting for the maintainer to approve or revise. | this mode |
| `spec:blocked` | An advisor still requested changes after one refinement, or drafting was refused. Waiting for the maintainer. | this mode |
| `spec:revise` | The maintainer sent the spec back with a note in the notes field. The next run re-drafts it and returns it as `spec:drafted`. | maintainer only |
| `spec:approved` | The maintainer approved the spec. The next run decomposes it. | maintainer only |
| `spec:decomposing` | Decomposition or analysis is in progress, or was interrupted. The next run completes it rather than starting over. | this mode |
| `spec:ready` | Every leaf has an Implementation Context block. This mode is finished with the root. | this mode |

### Order of work

Each run takes three passes in this order: the **approved pass**, then the
**revise pass**, then the **drafting pass**. The revise and drafting passes
share a cap of **2** roots per run; revised roots run first, so they consume
the cap first, and the drafting pass takes `2 − revised-this-run` roots. The
approved pass has no cap.

### Approved pass

Takes every root labelled `spec:approved` or `spec:decomposing` to
`spec:ready`. It runs first in every run and has no cap. Roots are taken by
priority, then oldest first:

```bash
bd list --label-any spec:approved,spec:decomposing --no-parent --status open --limit 0 --json \
  | jq -r 'sort_by(.priority, .created_at) | .[] | [.id, ((.labels // []) | map(select(startswith("spec:"))) | join(",")), .title] | @tsv'
```

`--label-any` works in bd 1.2.2; `--label-pattern` and `--label-regex` do not
(see the Selection rule).

**Route.** Re-read each root before starting on it. If its status is no
longer `open`, or it carries neither label, skip it and report it as
*skipped (taken mid-run)*. Otherwise route it. "Planned hierarchy heading"
means `(.notes // "") | test("(^|\n)#{1,6}[ \t]*Planned hierarchy\\b"; "i")`.

| Root | Path |
|---|---|
| `spec:decomposing` with a Planned hierarchy heading | **Resume** |
| `spec:approved` with a Planned hierarchy heading (only after a manual edit, since step 3 writes block and label together) | `bd update <id> --remove-label spec:approved --add-label spec:decomposing`, then **Resume**; planning again would duplicate children |
| anything else | **Plan** |

**Decomposition rules.** These bind the Plan step and the DECOMPOSE subagent.
Where they conflict with `decompose-bead.md`, they win. That covers its
three-level patterns in Phase 3 and its "SCOPE TBD" children.

1. At most two levels: root plus leaves. Every new bead's parent is the root.
   No container children, and no "SCOPE TBD" children. Every leaf meets
   decompose-bead.md's leaf criteria and is completable by one agent.
2. No prose gates. A gate is a `bd dep add` on a bead in this repo, or a
   defer date, or it is dropped. A blocker is never only a note.
3. No open design forks in a leaf. Pick the option and record why in the
   leaf's design. The exception is a fork the drafting pass's *Refuse rather
   than guess* list covers. Do not pick that one. Instead, make it its own
   leaf, titled `Decide: <question>`, whose description names the maintainer
   as the decider and lists the options. Then `bd dep add` every leaf it
   gates on that decision leaf.
4. Leaves cite files by path as of decomposition; analysis re-verifies each
   path exists before writing Implementation Context.
5. Children that already exist were written by the work's commissioner. Adopt
   them as the starting hierarchy. Do not create a bead that duplicates an
   existing child's scope. Add siblings under the root for scope nothing
   covers. You may update an existing child's description, design and
   acceptance so they agree with the approved design, but not its title.
   Never close or delete an existing child. If one is redundant, record that
   in the root's notes for the maintainer. An existing child that already has
   children is adopted as it stands. It goes in the block with Type
   `container`, and each of its children gets a row whose Parent is that
   child. Record it in the root's notes for the maintainer, since rule 1 would
   not have created it.
6. An oversized existing child is narrowed, not split. Shrink its description
   to one leaf's worth, add sibling leaves under the root for the rest, and
   record the narrowing in the root's notes. Splitting it into grandchildren
   would make it a container, which rule 1 forbids: containers never close,
   and the sweep skips them.

**Plan.** For a root routed here:

1. Run `npx tsx .agents/skills/bead-state-assessment/scripts/bead.ts sizing-check <id>`
   (prints `{needs_decomposition, reasons[]}`) and `bd children <id> --json`.
   The root is a **single-bead root** when `needs_decomposition` is false and
   it has no children. A root with children is decomposed whatever the sizing
   check says.
2. Plan the hierarchy yourself, not in a subagent. Apply decompose-bead.md
   Phases 2–3 under the decomposition rules. Write the block to
   `<session-scratchpad>/<id>-hierarchy.md`:

   ```
   ## Planned hierarchy

   | Title | Type | Parent | Depends on | Existing id |
   |---|---|---|---|---|
   | <exact title> | task | <root-id> | <titles or ids, or —> | <id, or new> |
   ```

   Write one row per leaf, and include existing children with their current
   title and id. For a single-bead root, replace the table with the line
   `- none: sizing-check needs_decomposition=false; analysed as a single bead`.
   The block is written in every case so the resume path always reads one.
   Below the block, in the same file, add
   `## Decisions made for you (decomposition)` in the drafting pass's format.
   It records each fork picked (rule 3), each child narrowed (rule 6) or
   judged redundant (rule 5), and the hierarchy shape chosen. Write `none` if
   there were none.
3. Append the block and relabel in **one** call, before any subagent runs:

   ```bash
   bd update <id> --append-notes "$(cat <session-scratchpad>/<id>-hierarchy.md)" \
     --remove-label spec:approved --add-label spec:decomposing
   ```

   The plan is on the bead before any child exists. A subagent that is cut
   partway then never leaves children without a recorded plan.
4. Go to **Decompose**. For a single-bead root, go to **Analyze**.

**Resume.** Read the **last** Planned hierarchy block and
`bd children <id> --json`. Do not re-plan. If the block is the `- none` line,
go to **Analyze**. If every row's title already matches a child of its
parent, go to **Analyze**. Otherwise go to **Decompose** with the resume line
added.

**Decompose.** Spawn the subagent with the prompt under `### Phase DECOMPOSE`,
followed by:

> Scheduled mode. Phase 3 is satisfied by the root's last `## Planned
> hierarchy` block. Create exactly what it lists, then run Phases 4–8. Never
> ask; decide, and report the decision. Every new row is a leaf: create it with
> the Phase 6 template under the Parent its row names. Phase 5 creates nothing. Before each `bd create`, check for an
> exact title match under the parent, and reuse its id if one exists:
> `bd children <parent> --json | jq -r --arg t "<title>" '.[] | select(.title == $t) | .id'`.
> Phase 7 adds the block's *Depends on* column as `bd dep add`, resolving each
> title to an id with the same lookup, and adding no dependency that already
> exists. The rules below override decompose-bead.md wherever they conflict,
> including its three-level patterns and its "SCOPE TBD" children:
> <the six decomposition rules above, verbatim>.

On the resume path, add: *"Create only the rows of the block whose title has
no match under its parent. Do not re-plan."*

**Analyze.** Branch on the root's shape first.

*Single-bead root* (the block is the `- none` line). If the root's own notes
hold an Implementation Context heading
(`(^|\n)#{1,6}[ \t]*Implementation Context\\b`, flag `i`), go to the gate.
Otherwise spawn the subagent with the prompt under `### Phase ANALYZE`. In
that prompt, replace the Phase 1.5 sentence ("The bead already has children.
Skip Phase 1.5 … Start from Phase 2") with *"Skip Phase 1.5. Use
analysis_mode = single and go to Phase 4b."* Then go to the gate.

*Decomposed root.* List the leaves still to analyse: open beads at any depth
under the root that have no children and no Implementation Context heading in
their notes. The walk goes to any depth because an adopted commissioner child
may already have children of its own; this mode never creates them.

```bash
bd list --all --limit 0 --json | jq -r --arg r <root-id> '
  (map({key: .id, value: .parent}) | from_entries) as $par
  | (map(.parent // empty) | unique) as $parents
  | def under($id): $par[$id] as $p | if $p == null then false elif $p == $r then true else under($p) end;
  [ .[] | select(under(.id)) | select(.id | IN($parents[]) | not) | select(.status != "closed")
    | select((.notes // "") | test("(^|\n)#{1,6}[ \t]*Implementation Context\\b"; "i") | not) ]
  | .[] | [.id, .title] | @tsv'
```

If it prints nothing, go to the gate. Otherwise spawn the subagent with the
prompt under `### Phase ANALYZE`, followed by:

> Scheduled mode. Analyse only these leaves: <ids from the query>. Never ask;
> flag issues in the report. Verify that every file path a leaf cites exists,
> and correct it in the Implementation Context if it has moved. Do not append
> a second Implementation Context block to a leaf that already has one. If the root's notes already hold a `# Bead Analysis` heading, skip
> Phase 5a.

**Gate to `spec:ready`.** For a single-bead root, test the root's own notes
for the Implementation Context heading. For a decomposed root, check two
things:
- every row of the last Planned hierarchy block has a title that matches a
  child of its Parent;
- the leaf query, re-run, prints nothing.

If anything is missing or unanalysed, leave the root `spec:decomposing` and
report what remains; the next run resumes it. Otherwise relabel:

```bash
bd update <id> --remove-label spec:decomposing --add-label spec:ready
```

analyze-bead Phase 5a appends `# Bead Analysis`, with its Execution Waves, to
a decomposed root. Sometimes the root's notes have no Bead Analysis heading
(`(^|\n)#{1,6}[ \t]*Bead Analysis\\b`, flag `i`) while an ANALYZE subagent
ran this run and returned an execution-wave summary. In that case, write
that summary under `# Bead Analysis` to
`<session-scratchpad>/<id>-waves.md`, and add
`--append-notes "$(cat <session-scratchpad>/<id>-waves.md)"` to the relabel
call. In any other case, append nothing. A resumed run that analyses nothing
has no summary to write, and a second block would duplicate the first.

The Planned hierarchy block is what makes a cut run safe. Each step after
it is idempotent: the title lookup skips children that exist, and the leaf
query skips leaves already analysed. The next run therefore completes the
root rather than duplicating it.

Out of scope: dispatching workers for `spec:ready` roots.

### Revise pass

Takes roots the maintainer sent back with `spec:revise`, re-drafts them as
`--reshape` does and re-advises them as `--readvise` does, under the drafting
pass's unattended rules, and returns them as `spec:drafted` (or
`spec:blocked`). It runs after the approved pass and before the drafting pass,
and takes cap slots first (see Order of work). Roots are taken by priority,
then oldest first. Take as many as the shared cap allows, and list the rest in
the report as *not taken (cap)*:

```bash
bd list --label spec:revise --no-parent --status open --limit 0 --json \
  | jq -r 'sort_by(.priority, .created_at) | .[] | [.id, .title] | @tsv'
```

For each selected root, in order:

**0. Check it was only drafted.** A root whose notes hold a Planned hierarchy
heading (`(^|\n)#{1,6}[ \t]*Planned hierarchy\\b`, flag `i`) has already been
through the approved pass. Re-drafting its fields would orphan its children.
Refuse it: number the revision as in step 2, and write only a
`## Decisions made for you (revision N)` block. Its first item is the refusal
*spec:revise on a root already decomposed*. Take the refusal row of the Write
table below.

**1. Read the note.** The maintainer's note is the text appended after the
bullets of the last `Decisions made for you` block, whatever its suffix.
`bd note` appends it on the next line, with no blank line between. The note
runs to the next heading or the end of the notes:

```bash
bd show <id> --json | jq -r '
  (.[0].notes // "") | [splits("(^|\n)#{1,6}[ \t]*Decisions made for you\\b")]
  | if length < 2 then "" else
      last | split("\n") | .[1:]
      | until(length == 0 or (.[0] | test("^[ \t]*$|^[ \t]+|^- \\*\\*Q:\\*\\*|^(- )?none[ \t]*$") | not); .[1:])
      | (map(test("^#{1,6} ")) | index(true)) as $h | (if $h then .[:$h] else . end)
      | join("\n")
    end'
```

The first `until` skips the block's own items, including any wrapped
continuation lines. The second drops everything from the first later heading
onwards.

If it prints nothing, do not re-draft, because a re-draft with no instruction
would be a guess. Refuse instead, as in step 0. The refusal item reads
*spec:revise with no note after the last Decisions block*.

**2. Number the revision.** N is 1 + the count of existing
`Decisions made for you (revision K)` headings:

```bash
bd show <id> --json | jq -r '(.[0].notes // "") | [match("(^|\n)#{1,6}[ \t]*Decisions made for you \\(revision [0-9]+\\)"; "g")] | length + 1'
```

Count the Decisions blocks, not the Advisory Review blocks: every revision
writes a Decisions block, but a refused one writes no Advisory Review.

**3. Re-draft** only the fields the note affects, as `--reshape` re-runs
DRAFT, holding each replacement in context; nothing is written until step 5.
Every drafting-pass rule applies: the overrides above, *Refuse rather than
guess*, and the commissioner's original reasoning stays verbatim in the
description, without a second opening paragraph. A note that asks for a change
on the refuse list is refused under that rule. Where the note can be partly
addressed without it, do that part and refuse the rest.

**4. Re-advise** as `--readvise` re-runs ADVISE: the drafting pass's
**Advise** step, with the whole revised plan given to every matched advisor.
Skip it on a refusal.

**5. Write.** Re-read the root first. If its status is no longer `open`, or it
no longer carries `spec:revise`, write nothing and report it as
*skipped (taken mid-run)*. Otherwise write everything in **one** `bd update`
call: the re-drafted fields, the notes and the labels.

```bash
F=<session-scratchpad>/<id>-rev<N>
bd update <id> --design "$(cat $F-design.md)" \
  --append-notes "$(cat $F-notes.md)" \
  --remove-label spec:revise --add-label shaped --add-label advised --add-label spec:drafted
```

Pass `--description`, `--design` and `--acceptance` only for the fields
re-drafted. Vary only the labels:

| Outcome | Labels |
|---|---|
| advisors ran, none still requests changes | `--remove-label spec:revise --add-label shaped --add-label advised --add-label spec:drafted` |
| no advisor plausibly applies | `--remove-label spec:revise --remove-label advised --add-label shaped --add-label spec:drafted` |
| REQUEST CHANGES persisted after the refinement | `--remove-label spec:revise --remove-label advised --add-label shaped --add-label spec:blocked` |
| refusal (steps 0, 1 or 3) | `--remove-label spec:revise --remove-label advised --add-label shaped --add-label spec:blocked` |

Drop `--add-label shaped` where description, design or acceptance is still
empty. `advised` is removed on every outcome but the first because the label
describes the current spec, which no longer cleared review. bd accepts
removing a label the root does not carry.

The notes file holds, in order:
1. `## Advisory Review (revision N)`: one line per advisor in the Phase ADVISE
   format, or `- none applicable — <why>`. Omit it on a refusal;
2. `## Decisions made for you (revision N)`, in the format below. Its first
   items say how the note was addressed and, if any part was not, which part
   and why (a refusal is that item, and comes first).

Append only: never edit or remove an earlier block, and never use `--notes`.
Readers take the **last** block of each name. Read back with
`bd show <id> --json | jq -r '.[0].notes'`: the revision blocks follow every
earlier block, which are unchanged.

One call makes a cut run safe. Cut before it, and the root still carries
`spec:revise` with its note last and no new block, so the next run redoes the
revision from the same note.

### Selection rule (drafting pass)

This is the selection rule; amend it here and nowhere else. One criterion per
`jq` line, so any criterion is a one-line edit. A bead is a candidate when:

- it carries a label matching `office:*`;
- it has no parent;
- its status is `open` (not in progress, not closed);
- it carries no `spec:*` label and no `needs-human` label;
- its notes contain no Advisory Review heading (any level, case-insensitive —
  a plain substring would also catch prose such as "advisory review passed");
- none of its children is `in_progress` or `closed` (a root with started
  children has shipped work under it; children that are all open are
  commissioner-written and are part of the brief).

Candidates are ordered by priority, then oldest first.

```bash
bd list --all --limit 0 --json | jq -r '
  ( map(select(.parent != null and (.status == "in_progress" or .status == "closed")) | .parent)
    | unique ) as $started
  | [ .[]
      | select(.parent == null and .status == "open")
      | select(any((.labels // [])[]; startswith("office:")))
      | select(all((.labels // [])[]; (startswith("spec:") or . == "needs-human") | not))
      | select((.notes // "") | test("(^|\n)#{1,6}[ \t]*Advisory Review\\b"; "i") | not)
      | select(.id | IN($started[]) | not)
    ]
  | sort_by(.priority, .created_at)
  | .[] | [.id, "P\(.priority)", .created_at[0:10], .title] | @tsv'
```

`--limit 0` is mandatory: `bd list --json` otherwise stops at 50 rows. Do not
use `--label-pattern` or `--label-regex`; bd 1.2.2 ignores both and returns
every row. Take the first `2 − revised-this-run` rows; list the rest in the
report as *not taken (cap)*.

### Drafting pass

For each selected root, in order:

**Draft.** Treat the bead's existing description as the brief. Keep it
verbatim, open it with a short plain-language paragraph, and extend it with
scope and success criteria; do not replace the commissioner's reasoning. If
the root has children, read them (`bd children <id>`) as part of the brief:
the design must account for them, but do not restructure them here. As in
attended DRAFT, skip a sub-step whose field is already populated, except the
description, which is always extended as above. Sub-step 1
(clarify scope) is answered from the brief; sub-step 2 (visuals) is skipped
and recorded as a decision; run sub-steps 3–7 (reference implementations,
product context, standards, technical design, acceptance) as written.

**Refuse rather than guess** when drafting would require any of these:

- changing a public URL or slug shape: anything that changes
  `src/common/routing/public-paths.ts`, `src/common/routing/reserved-segments.ts`,
  `src/site/routes.ts`, or calendar or series url-name rules (DEC-018);
- changing federation semantics: which activities are emitted or accepted,
  their type, addressing or object shape, actor-document properties, or inbox
  and outbox trust rules (DEC-013, DEC-014, and DEC-015 *federated report
  routing*);
- a destructive data migration: dropping or renaming a column or table, or
  deleting or irreversibly rewriting rows;
- contradicting, amending or superseding a decision in `docs/decisions/` whose
  Status is Accepted, or any still-in-force clause of a decision, whatever its
  file's Status. Examples: adopting an ActivityPub library (DEC-012), or using
  `@` in public URLs (DEC-006). Decision text has override priority, so
  changing one is the product owner's call. Proposing a brand-new DEC is not a
  refusal; record it as a decision made.

On a refusal, write whatever fields are complete, skip ADVISE (an Advisory
Review block would make the bead read as advised), record the refusal as the
first item under *Decisions made for you*, and label the root `spec:blocked`
(labels per the Write table).

**Advise.** Run Phase ADVISE as written — same discovery
(`npx tsx .agents/skills/agent-discovery/scripts/agents.ts advisor`), same
single Task batch, same plan template — with these differences:

- On APPROVE WITH CONDITIONS or REQUEST CHANGES, adjust the draft yourself
  instead of asking, re-run only the affected advisors once, and record each
  adjustment as a decision.
- If no advisor plausibly applies, proceed without `advised` and record that
  as a decision.
- If any advisor still returns REQUEST CHANGES after the single refinement,
  still write the fields, the Advisory Review block and the decisions block,
  label the root `spec:blocked`, add no `advised` label, and stop on that root.

**Write.** Re-read the root first. If its status is no longer `open`, or it
now carries a `spec:*` label, someone else has taken it during this run, for
example a `/clear-backlog` sweep. Write nothing and report it as
*skipped (taken mid-run)*. Otherwise, write what CONFIRM-AND-WRITE writes, with
no approval prompt, in **one** `bd update` call carrying the fields, the notes
and the labels:

```bash
F=<session-scratchpad>/<id>
bd update <id> --description "$(cat $F-description.md)" \
  --design "$(cat $F-design.md)" --acceptance "$(cat $F-acceptance.md)" \
  --append-notes "$(cat $F-notes.md)" \
  --add-label shaped --add-label advised --add-label spec:drafted
```

Vary only the labels, and drop the flag of any field not written:

| Outcome | Labels |
|---|---|
| advisors ran, none still requests changes | `shaped`, `advised`, `spec:drafted` |
| no advisor plausibly applies | `shaped`, `spec:drafted` |
| REQUEST CHANGES persisted after the refinement | `shaped`, `spec:blocked` |
| refusal, all three fields written | `shaped`, `spec:blocked` |
| refusal, some field not written | `spec:blocked` |

One call makes a cut run safe. Cut before it, and the root is exactly as the
commissioner left it, so the next run re-selects it and drafts from the
original brief without doubling the opening paragraph. Split across calls, a
cut could leave an Advisory Review block with no `spec:*` label, and that
root would drop out of every pass. Write each text to a file in the session
scratchpad first, because a heredoc inside `$()` breaks on bash 3.2. Append
notes only, with `--append-notes` or `bd note`, never `--notes`.

The notes file holds, in order:
1. references;
2. applicable standards;
3. `## Advisory Review`: one line per advisor in the Phase ADVISE format, or
   `- none applicable — <why>`. Omit it on a refusal;
4. `## Decisions made for you`.

Read back with `bd show <id>` and run the CONFIRM-AND-WRITE checklist. Stop
there: **no decomposition and no analysis in this pass**, and no children
created.

### Decisions made for you

A bulleted list under `## Decisions made for you` in the root's notes. Each
item is the question the attended command would have asked, the answer
chosen, and one line of why:

```
- **Q:** <question attended mode would have asked> — **A:** <answer> — <why>
```

Refusals come first. Each item goes on one line and is never wrapped, because
the revise pass finds the maintainer's note by skipping these lines. If the
attended command would have asked nothing, write `none`.

### Per-run report

Write `reports/spec-plan/<YYYY-MM-DD>.md` (`$(date +%F)`) in the workspace
(`reports/` is gitignored — verify with `git check-ignore`, and add the pattern
if missing). If the file already exists, append a `## Run <HH:MM>` section
rather than overwriting the earlier run's record. Contents:

- each root touched: id, title, pass, resulting label, advisor verdict lines,
  count of decisions made, and any refusals or errors
- for each revise-pass root: its revision number, and whether the note was
  fully addressed
- for each approved-pass root: its leaf count (`1 (the root)` for a
  single-bead root), or the leaves still unanalysed if it stays
  `spec:decomposing`
- the candidates **not taken (cap)**, with priority and title

The report is local and gitignored, so bead IDs are allowed there — they
remain forbidden in branches, commits, and PRs.

## Tips

- **Keep planning fast** — Capture enough to start, refine as you build
- **Visuals are optional** — Not every feature needs mockups
- **Standards guide, not dictate** — They inform the plan but aren't always mandatory
- **The scratchpad is the review surface** — Encourage the user to open `draft.md` before approving; that's its purpose
- **Subagents get fresh context** — Decompose and analyze run with clean context, reading the command files directly
