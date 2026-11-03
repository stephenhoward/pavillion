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

Unattended run, modelled on `/clear-backlog --scheduled`. It never waits on a
human: every question the attended command would ask is answered by best
judgement and written on the bead, and every run writes a report file.
Refuse it with a bead id, `--until`, `--reshape` or `--readvise`: the
selection rule is the whole input, and a hybrid would be an untested path.

**Overrides of the attended flow.** The phases above apply as written, except:

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
- Do not route on `bead.ts state` or `enrichment-check`: both match "Advisory
  Review" and "Implementation Context" as substrings anywhere in `bd show`,
  description included. Use the heading test.

### Labels

The canonical state vocabulary, which the passes cite rather than restate. A
root carries at most one of these labels; every *State write* enforces it.

| Label | Meaning | Set by |
|---|---|---|
| `spec:drafted` | Description, design and acceptance written; advisors reviewed (or none applied — then without `advised`). Waiting for the maintainer to approve or revise. | this mode |
| `spec:blocked` | Drafting or revising was refused in whole or part, an advisor still requested changes after one refinement, a revise reached an already-decomposed root, or decomposition missed its gate three times. Waiting for the maintainer, who restarts it by setting `spec:revise` with a note, never by removing the label. | this mode |
| `spec:revise` | The maintainer sent the spec back with a note in the notes field. The next run re-drafts it and returns it as `spec:drafted`. | maintainer only |
| `spec:approved` | The maintainer approved the spec. The next run decomposes it. | maintainer only |
| `spec:decomposing` | Decomposition or analysis is in progress, or was interrupted. The next run completes it rather than starting over. | this mode |
| `spec:ready` | Every leaf has an Implementation Context block; for a single-bead root, the root's own notes hold it. This mode is finished with the root. | this mode |

### Shared rules

- **Heading test.** "Has an *X* heading" means
  `(.notes // "") | test("(^|\n)#{1,6}[ \t]*X\\b"; "i")`: any level or case,
  never a plain substring, which would catch prose such as "advisory review
  passed". `\b` closes a name ending in a word character.
- **State write.** A state write to `<target>` is `--remove-label` for each of
  the six labels except the target, plus `--add-label <target>`; for
  `spec:drafted`: `--remove-label spec:blocked --remove-label spec:revise --remove-label spec:approved --remove-label spec:decomposing --remove-label spec:ready --add-label spec:drafted`.
  Every relabel here is one; bd accepts removing an absent label.
- **One call per write.** Each write is **one** `bd update` with its fields,
  notes and labels: a cut before it leaves the next run to redo the step from
  the same input, where split calls could leave an Advisory Review block with
  no `spec:*` label, and that root would drop out of every pass.
- **Files.** Pass every text as `"$(cat <file>)"` from a file in the session
  scratchpad; a heredoc inside `$()` breaks on bash 3.2.
- **Append only.** Notes take `--append-notes` or `bd note`, never `--notes`;
  never edit an earlier block. Readers take the **last** block of each name.
- **Mid-run re-read.** Where a pass says, re-read the root. If it is no
  longer `open`, or lacks what selected it, someone (a `/clear-backlog`
  sweep, say) took it this run: write nothing; report *skipped (taken mid-run)*.
- **needs-human.** Every selection prints the `needs-human` label. Such a root
  is not selected, takes no cap slot, and is reported *skipped (needs-human)*.
- **bd 1.2.2.** `--limit 0` is mandatory (`bd list --json` otherwise stops at
  50 rows). `--label-pattern` and `--label-regex` are ignored and return every
  row; use `--label` or `--label-any`.
- **Design rulings.** Maintainer rulings on design forks, made before
  drafting, live in notes blocks with a Design ruling heading and in a
  `## Design rulings` description block, kept verbatim. Each is settled: never
  re-ask, contradict or list it under *Decisions made for you*. It also
  settles a *Refuse rather than guess* fork: the maintainer's call in advance.

### Note blocks

Tooling outside this command parses these two blocks in the root's notes,
whatever their suffix, so their shape is a contract.
**`## Decisions made for you`** holds only questions the attended command
would have put to the maintainer that no design ruling settles, each on one
unwrapped line, refusals first:

```
- **Q:** <question attended mode would have asked> — **A:** <answer> — <why>
- **Q:** <what was asked or attempted> — **A:** refused — <reason>
```

The revise pass finds a plain-text note by skipping these lines. An empty
block is exactly `none`. Below-the-line choices are ordinary design, in the
design field: implementation details, visuals skipped, how an advisor's
condition was met.

**`## Advisory Review`** has one line per advisor with its **final** verdict
only, in the Phase ADVISE format, and per adjustment a verdict-free line
`- adjusted for <advisor>: <change>`. Consumers scan for `REQUEST CHANGES`,
so it appears only as a final verdict. With no advisor applicable, the block
is `- none applicable — <why>`.

### Outcome labels

The drafting and revise passes end each root on one row:

| Outcome | Labels |
|---|---|
| advisors ran, none still requests changes | `shaped`, `advised`, state write `spec:drafted` |
| no advisor plausibly applies | `shaped`, state write `spec:drafted` |
| REQUEST CHANGES persisted after the refinement | `shaped`, state write `spec:blocked` |
| any refusal, whole or partial | `shaped`, state write `spec:blocked` |

Drop `shaped` while description, design or acceptance is empty. In the revise
pass the state write also removes `spec:revise`, and a row without `advised`
adds `--remove-label advised` only when a field was re-drafted: the label
describes the current spec, and a refusal that changes nothing leaves the
reviewed spec in place.

### Order of work

Each run takes the **approved pass** (no cap), the **revise pass**, then the
**drafting pass**. The last two share a cap of **2** roots per run; revised
roots run first, so the drafting pass takes `2 − revised-this-run`, which
counts every revise-pass root selected, refused or *skipped (taken mid-run)*
included. The rest are *not taken (cap)*.

### Approved pass

Takes every `spec:approved` or `spec:decomposing` root to `spec:ready`, by
priority, then oldest first:

```bash
bd list --label-any spec:approved,spec:decomposing --no-parent --status open --limit 0 --json \
  | jq -r 'sort_by(.priority, .created_at) | .[]
      | [.id, "P\(.priority)", ((.labels // []) | map(select(startswith("spec:") or . == "needs-human")) | join(",")), .title] | @tsv'
```

**Route.** Re-read each root before starting (*Mid-run re-read*: it must
still carry `spec:approved` or `spec:decomposing`). Skip and report one that
also carries `spec:revise`; the revise pass takes it. Otherwise:

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
   becomes its own leaf, `Decide: <question>`, whose description names the
   maintainer as decider and lists the options, and every leaf it gates gets
   a `bd dep add` on it.
4. Leaves cite files by path as of decomposition; analysis re-verifies each
   path exists before writing Implementation Context.
5. Children that already exist were written by the work's commissioner. Adopt
   them as the starting hierarchy, create nothing that duplicates one's
   scope, and add siblings under the root for scope nothing covers. You may
   update an existing child's description, design and acceptance to agree
   with the approved design, but not its title; never close or delete one,
   and record a redundant one in the decomposition Decisions block. One with
   children of its own is adopted as it stands, recorded there too: Type
   `container` in the block, and a row per child whose Parent is that child.
6. An oversized existing child is narrowed, not split: shrink its description
   to one leaf's worth, add sibling leaves under the root for the rest, and
   record it in the decomposition Decisions block. Grandchildren would make it
   a container, which rule 1 forbids: containers never close, and the sweep
   skips them.

**Plan.** For a root routed here:

1. Run `npx tsx .agents/skills/bead-state-assessment/scripts/bead.ts sizing-check <id>`
   (prints `{needs_decomposition, reasons[]}`) and `bd children <id> --json`.
   It is a **single-bead root** when `needs_decomposition` is false and it
   has no children. A root with children is decomposed whatever the sizing
   check says.
2. Plan the hierarchy yourself, not in a subagent: decompose-bead.md
   Phases 2–3 under the decomposition rules. Write to
   `<session-scratchpad>/<id>-hierarchy.md`:

   ```
   ## Planned hierarchy

   | Title | Type | Parent | Depends on | Existing id |
   |---|---|---|---|---|
   | <exact title> | task | <root-id> | <titles or ids, or —> | <id, or new> |
   ```

   One row per leaf, existing children included by current title and id. For
   a single-bead root the table is the line
   `- none: sizing-check needs_decomposition=false; analysed as a single bead`,
   so Resume always reads a block. Below it in the same file goes the
   decomposition Decisions block, `## Decisions made for you (decomposition)`
   per *Note blocks*: the hierarchy shape chosen, and what rules 5 and 6 record.
3. Before any subagent runs, in one call, append the file and make a state
   write to `spec:decomposing`, so a cut subagent never leaves children
   without a recorded plan.
4. Go to **Decompose**; for a single-bead root, to **Analyze**.

**Resume.** Read the **last** Planned hierarchy block and
`bd children <id> --json`; do not re-plan. Go to **Analyze** if the block is
the `- none` line or every row's title matches a child of its Parent, else
to **Decompose**.

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

**Analyze.** *Single-bead root* (the `- none` line): with an Implementation
Context heading, go to the gate. Otherwise spawn the `### Phase ANALYZE`
prompt with its Phase 1.5 sentence ("The bead already has children. Skip
Phase 1.5 … Start from Phase 2") replaced by *"Skip Phase 1.5. Use
analysis_mode = single and go to Phase 4b."*, then go to the gate.

*Decomposed root*: list the leaves still to analyse, beads under the root that
are not closed, have no children and have no Implementation Context heading,
at any depth, because an adopted commissioner child may have children.

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

**Gate to `spec:ready`.** A single-bead root passes when it has an
Implementation Context heading; a decomposed root, when every row of the last
Planned hierarchy block matches a child of its Parent by title and the leaf
query, re-run, prints nothing. On a pass, make a state write to `spec:ready`,
and if the root has no Bead Analysis heading but an ANALYZE subagent returned
an execution-wave summary this run, append it under `# Bead Analysis` in the
same call; otherwise append nothing, as a second block would duplicate it.

On a miss the root stays `spec:decomposing` for the next run. Count earlier
misses with
`bd show <id> --json | jq -r '(.[0].notes // "") | [match("(^|\n)- gate not met [0-9]{4}-[0-9]{2}-[0-9]{2}:"; "g")] | length'`,
then in one call append `- gate not met <YYYY-MM-DD>: <what remains>`,
preceded by a `## Decomposition gate` heading only if the root has none. If
the count was 2, this is the third miss: the same call appends
`## Decisions made for you (decomposition gate)` with
`- **Q:** Finish decomposing this root? — **A:** stopped — <what never completed>`
and makes a state write to `spec:blocked`.

The Planned hierarchy block makes a cut run safe: every later step is
idempotent (the title lookup reuses children, the leaf query skips analysed
leaves), so the next run completes the root rather than duplicating it.

### Revise pass

Re-drafts roots sent back with `spec:revise` as `--reshape` does, re-advises
them as `--readvise` does, under the drafting pass's rules, and ends each on
a row of *Outcome labels*. Roots run by priority, then oldest first:

```bash
bd list --label spec:revise --no-parent --status open --limit 0 --json \
  | jq -r 'sort_by(.priority, .created_at) | .[]
      | [.id, "P\(.priority)", .created_at[0:10], (if any((.labels // [])[]; . == "needs-human") then "needs-human" else "-" end), .title] | @tsv'
```

**0. Check it was only drafted.** A root with a Planned hierarchy heading has
been through the approved pass; re-drafting would leave its children or
Implementation Context describing a different spec. Refuse it: number the
revision (step 2) and, in one call, append only a
`## Decisions made for you (revision N)` block whose first item is
`- **Q:** Re-draft this root? — **A:** refused — it was already decomposed; revise its leaves or the root by hand`,
with a state write to `spec:blocked`.

**1. Read the note.** It follows the last `Decisions made for you` heading,
whatever its suffix. If a heading there ends `revision (<YYYY-MM-DD>)`, as
the maintainer's tooling writes it, the note is the body of the last such
block (the date tells it from this mode's `(revision N)` headings).
Otherwise it is plain text appended by `bd note` after the block's items,
not under a heading and not starting `- **`. Either runs to the next heading
or the end.

```bash
bd show <id> --json | jq -r '
  (.[0].notes // "") | [splits("(^|\n)#{1,6}[ \t]*Decisions made for you\\b"; "i")]
  | if length < 2 then "" else
      (last | split("\n") | .[1:]) as $l
      | ([$l | to_entries[] | select(.value | test("^#{1,6}[ \t]*[^\n]*\\brevision \\([0-9]{4}-[0-9]{2}-[0-9]{2}\\)"; "i")) | .key] | last) as $t
      | (if $t then $l[$t + 1:] | until(length == 0 or (.[0] | test("^[ \t]*$") | not); .[1:])
         else $l | until(length == 0 or (.[0] | test("^[ \t]*$|^[ \t]+|^- \\*\\*|^(- )?none[ \t]*$") | not); .[1:]) end)
      | (map(test("^#{1,6}[ \t]")) | index(true)) as $h | (if $h then .[:$h] else . end)
      | until(length == 0 or (last | test("^[ \t]*$") | not); .[:-1])
      | join("\n")
    end'
```

The plain-text branch skips the block's `- **` items and wrapped lines; both
cut at the next heading, so a following Design ruling block is not the note.
If it prints nothing, a re-draft would be a guess: refuse as in step 0, with
`- **Q:** Re-draft this root? — **A:** refused — spec:revise with no note after the last Decisions block`.

**2. Number the revision.** N is 1 + the count of
`Decisions made for you (revision K)` headings, not Advisory Review ones,
which a refused revision does not write:
`bd show <id> --json | jq -r '(.[0].notes // "") | [match("(^|\n)#{1,6}[ \t]*Decisions made for you \\(revision [0-9]+\\)"; "gi")] | length + 1'`.

**3. Re-draft** only the fields the note affects, as `--reshape` re-runs
DRAFT, holding each in context until step 5. Every drafting-pass rule
applies: the overrides, *Refuse rather than guess*, and the commissioner's
reasoning kept verbatim without a second opening paragraph. A design ruling
appended after the last Decisions block is newer than the spec: apply it. A
note asking for a change on the refuse list is refused; where it can be
partly addressed without that change, do that part and refuse the rest.

**4. Re-advise** as `--readvise` re-runs ADVISE: the drafting pass's
**Advise** step, with the whole revised plan given to every matched advisor.
Skip it only when step 3 re-drafted no field.

**5. Write.** Re-read the root (*Mid-run re-read*: it must still carry
`spec:revise`), then write as the drafting pass's **Write** does, with only
the re-drafted fields, from `<session-scratchpad>/<id>-rev<N>-*.md`. The
notes file holds `## Advisory Review (revision N)` (omitted when no field was
re-drafted), then `## Decisions made for you (revision N)`, whose first items
say how the note was addressed and what was not, and why, refusal first:
`- **Q:** How was the note addressed? — **A:** <what changed> — <why>`. Read
back with `bd show <id> --json | jq -r '.[0].notes'`: the new blocks follow
every earlier one, unchanged.

### Selection rule (drafting pass)

This is the selection rule; amend it here and nowhere else. One criterion per
`jq` line, so any criterion is a one-line edit. A bead is a candidate when:

- it carries a label matching `office:*`, has no parent, and is `open`;
- it carries no `spec:*` label (nor `needs-human`, per *needs-human*) and has
  no Advisory Review heading;
- none of its children is `in_progress` or `closed` (started children mean
  shipped work; all-open children are commissioner-written, part of the brief).

Candidates are ordered by priority, then oldest first. Take as many rows not
marked `needs-human` as *Order of work* leaves.

```bash
bd list --all --limit 0 --json | jq -r '
  ( map(select(.parent != null and (.status == "in_progress" or .status == "closed")) | .parent)
    | unique ) as $started
  | [ .[]
      | select(.parent == null and .status == "open")
      | select(any((.labels // [])[]; startswith("office:")))
      | select(all((.labels // [])[]; startswith("spec:") | not))
      | select((.notes // "") | test("(^|\n)#{1,6}[ \t]*Advisory Review\\b"; "i") | not)
      | select(.id | IN($started[]) | not)
    ]
  | sort_by(.priority, .created_at)
  | .[] | [.id, "P\(.priority)", .created_at[0:10], (if any((.labels // [])[]; . == "needs-human") then "needs-human" else "-" end), .title] | @tsv'
```

### Drafting pass

**Draft.** Treat the bead's existing description as the brief. Keep it
verbatim, open it with a short plain-language paragraph, and extend it with
scope and success criteria; do not replace the commissioner's reasoning. Read
any children (`bd children <id>`) as part of the brief: the design accounts
for them, but does not restructure them. As in attended DRAFT, skip a
sub-step whose field is populated, except the description. Sub-step 1 is
answered from the brief; sub-step 2 (visuals) is skipped, and the design says
so; sub-steps 3–7 run as written.

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
  --add-label shaped --add-label advised <state write to spec:drafted>
```

The notes file holds references, applicable standards, `## Advisory Review`
(omitted on a refusal) and `## Decisions made for you`, in that order. A cut
before the write leaves the root as the commissioner left it, so the next run
drafts from the original brief without doubling the opening paragraph. Read
back with `bd show <id>` and run the CONFIRM-AND-WRITE checklist. Stop there:
**no decomposition and no analysis in this pass**, and no children created.

### Per-run report

Write `reports/spec-plan/<YYYY-MM-DD>.md` (`$(date +%F)`) in the workspace
(`reports/` is gitignored — verify with `git check-ignore`, and add the pattern
if missing), appending a `## Run <HH:MM>` section if it exists. Contents:

- each root touched: id, title, pass, resulting label, advisor verdict lines,
  count of decisions made, and any refusals or errors
- each revise-pass root: revision number, and whether the note was fully addressed
- each approved-pass root: its leaf count (`1 (the root)` for a single-bead
  root), or the leaves still unanalysed if it stays `spec:decomposing`; each
  `Decide:` leaf it created, for the maintainer to decide; and whether the
  gate bound blocked it, with what never completed
- the roots *skipped (taken mid-run)*, *skipped (needs-human)*, or skipped by
  the approved pass for also carrying `spec:revise`; and those
  **not taken (cap)**, with priority and title

The report is local and gitignored, so bead IDs are allowed there — they
remain forbidden in branches, commits, and PRs.

## Tips

- **Keep planning fast** — Capture enough to start, refine as you build
- **Visuals are optional** — Not every feature needs mockups
- **Standards guide, not dictate** — They inform the plan but aren't always mandatory
- **The scratchpad is the review surface** — Encourage the user to open `draft.md` before approving; that's its purpose
- **Subagents get fresh context** — Decompose and analyze run with clean context, reading the command files directly
