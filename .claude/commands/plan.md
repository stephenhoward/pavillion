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
```

## Important Guidelines

- **Always use AskUserQuestion tool** when asking the user anything
- **Detect state first** — Read `bd show <id>` (if a bead exists) and use the `bead-state-assessment` skill to determine what phase to start at
- **Offer suggestions** — Present options the user can confirm, adjust, or correct
- **Keep it lightweight** — This is planning, not exhaustive documentation
- **Output to bead** — All durable content writes to bead fields, not committed spec folders
- **Use the scratchpad as a review surface** — A spec scratchpad under `docs/.scratch/` (gitignored) holds the full plan for human review before it lands on the bead. After the bead is written, the scratchpad is deleted.

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
4. **Product context** — read `agent-os/product/mission.md`, `roadmap.md`; check alignment
5. **Standards** — read `.claude/skills/standards-routing/index.yml`; confirm applicable ones
6. **Technical design** — approach, key files, patterns, integration points
7. **Acceptance criteria** — testable checklist

Write the full plan to `docs/.scratch/<timestamp>-<slug>/draft.md` as a single readable document with sections for each field that will land on the bead.

**Exit condition for `--until shaped`:** if the user requested to stop after fields are written but before advisors, proceed straight to CONFIRM-AND-WRITE without running ADVISE.

### Phase ADVISE

Pick advisors via the [`agent-discovery`](../skills/agent-discovery/SKILL.md) skill. Pipe the design's **Key Files** (from DRAFT) one per line into `match-agents.sh advisor`; the JSON array it emits is the advisor set. If the array is empty, ask the user whether to proceed without advisory review or revisit the design.

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

> Read `.claude/commands/decompose-bead.md` and follow its full process for bead `<bead-id>`.
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

> Read `.claude/commands/analyze-bead.md` and follow its full process for bead `<epic-id>`.
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

## Tips

- **Keep planning fast** — Capture enough to start, refine as you build
- **Visuals are optional** — Not every feature needs mockups
- **Standards guide, not dictate** — They inform the plan but aren't always mandatory
- **The scratchpad is the review surface** — Encourage the user to open `draft.md` before approving; that's its purpose
- **Subagents get fresh context** — Decompose and analyze run with clean context, reading the command files directly
