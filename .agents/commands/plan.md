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
- Skip the CONFIRM-AND-WRITE approval gate, and skip the DECOMPOSE prompt and
  ANALYZE prompt phases.
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

| Label | Meaning | Set by |
|---|---|---|
| `spec:drafted` | Description, design and acceptance written; advisors reviewed. Waiting for the maintainer to approve or revise. | this mode |
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
      | select((.notes // "") | test("(^|\n)#{1,6}[ \t]*Advisory Review"; "i") | not)
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
attended DRAFT, skip a sub-step whose field is already populated. Sub-step 1
(clarify scope) is answered from the brief; sub-step 2 (visuals) is skipped
and recorded as a decision; run sub-steps 3–7 (reference implementations,
product context, standards, technical design, acceptance) as written.

**Refuse rather than guess** when drafting would require any of these:

- changing a public URL or slug shape: anything that changes
  `src/common/routing/public-paths.ts`, `src/common/routing/reserved-segments.ts`,
  `src/site/routes.ts`, or calendar or series url-name rules (DEC-018);
- changing federation semantics: which activities are emitted or accepted,
  their type, addressing or object shape, actor-document properties, or inbox
  and outbox trust rules (DEC-012, DEC-013, DEC-014, DEC-015);
- a destructive data migration: dropping or renaming a column or table, or
  deleting or irreversibly rewriting rows;
- contradicting, amending or superseding a decision in `docs/decisions/` whose
  Status is Accepted, or a still-in-force clause of a Partially superseded
  one. Decision text has override priority, so changing one is the product
  owner's call. Proposing a brand-new DEC is not a refusal; record it as a
  decision made.

On a refusal, write whatever fields are complete, skip ADVISE (an Advisory
Review block would make the bead read as advised), record the refusal as the
first item under *Decisions made for you*, and label the root `spec:blocked`.
Add `shaped` only if description, design and acceptance were all written.

**Advise.** Run Phase ADVISE as written — same discovery
(`npx tsx .agents/skills/agent-discovery/scripts/agents.ts advisor`), same
single Task batch, same plan template — with these differences:

- On APPROVE WITH CONDITIONS or REQUEST CHANGES, adjust the draft yourself
  instead of asking, re-run only the affected advisors once, and record each
  adjustment as a decision.
- If no advisor plausibly applies, proceed and record that as a decision.
- If any advisor still returns REQUEST CHANGES after the single refinement,
  still write the fields, the Advisory Review block and the decisions block,
  label the root `spec:blocked`, add no `advised` label, and stop on that root.

**Write.** Write the fields as CONFIRM-AND-WRITE does, with no approval
prompt. First `--description`, `--design` and `--acceptance` as separate
`bd update` calls. Then **one** final call carries the notes and the labels
together:

```bash
# drafted
bd update <id> --append-notes "$(cat <session-scratchpad>/<id>-notes.md)" \
  --add-label shaped --add-label advised --add-label spec:drafted
# blocked (advisor REQUEST CHANGES persisted, or refusal with all three fields written)
bd update <id> --append-notes "$(cat <session-scratchpad>/<id>-notes.md)" \
  --add-label shaped --add-label spec:blocked
```

Notes and labels share a call so a cut run is safe: cut before it, and the
root has no Advisory Review heading and no `spec:*` label, so the next run
re-selects it and redrafts cleanly; split across two calls, a cut between them
would leave an Advisory Review block with no label and the root would drop out
of every pass. Write the notes text to a file in the session scratchpad first —
a heredoc inside `$()` breaks on bash 3.2. Append only: `--append-notes` or
`bd note`, never `--notes`.

The notes file holds, in order: references, applicable standards,
`## Advisory Review` (one line per advisor in the Phase ADVISE format, omitted
on a refusal), then `## Decisions made for you`.

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

Refusals come first. If the attended command would have asked nothing, write
`none`.

### Per-run report

Write `reports/spec-plan/<YYYY-MM-DD>.md` (`$(date +%F)`) in the workspace
(`reports/` is gitignored — verify with `git check-ignore`, and add the pattern
if missing). If the file already exists, append a `## Run <HH:MM>` section
rather than overwriting the earlier run's record. Contents:

- each root touched: id, title, pass, resulting label, advisor verdict lines,
  count of decisions made, and any refusals or errors
- the candidates **not taken (cap)**, with priority and title

The report is local and gitignored, so bead IDs are allowed there — they
remain forbidden in branches, commits, and PRs.

## Tips

- **Keep planning fast** — Capture enough to start, refine as you build
- **Visuals are optional** — Not every feature needs mockups
- **Standards guide, not dictate** — They inform the plan but aren't always mandatory
- **The scratchpad is the review surface** — Encourage the user to open `draft.md` before approving; that's its purpose
- **Subagents get fresh context** — Decompose and analyze run with clean context, reading the command files directly
