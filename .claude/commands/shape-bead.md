# Shape Bead

Fill a bead's structured fields with enough context for decomposition and implementation. **Run this command in plan mode.**

## Important Guidelines

- **Always use AskUserQuestion tool** when asking the user anything
- **Assess first** — Read what exists on the bead and skip steps that are already satisfied
- **Offer suggestions** — Present options the user can confirm, adjust, or correct
- **Keep it lightweight** — This is shaping, not exhaustive documentation
- **Write to bead fields** — Use `bd update` with `--description`, `--design`, `--acceptance`, `--append-notes`, `--add-label`

## Prerequisites

This command **must be run in plan mode**.

**Before proceeding, check if you are currently in plan mode.**

If NOT in plan mode, **stop immediately** and tell the user:

```
Shape-bead must be run in plan mode. Please enter plan mode first, then run /shape-bead again.
```

Do not proceed with any steps below until confirmed to be in plan mode.

## Arguments

The user should provide a bead ID: `/shape-bead beads-XXX`

If no bead ID is provided, check for the most recent bead:
```bash
bd list --status=open --limit=5
```

Ask the user which bead to shape, or if they want to create a new one first.

## Process

### Step 1: Read the Bead

```bash
bd show <bead-id>
```

Assess what's already there:
- **Title** — Is it clear and descriptive?
- **Description** — Does it explain what and why?
- **Design** — Is there a technical approach?
- **Acceptance** — Are there testable criteria?
- **Notes** — Any context, references, standards?
- **Labels** — Does it already have `shaped`?

If the bead already has the `shaped` label, tell the user:

```
This bead was already shaped. Do you want to reshape it (update fields), or proceed to /decompose-bead?
```

**Key principle:** Steps 2-8 below should be skipped if the corresponding field is already well-populated. Only work on gaps.

### Step 2: Clarify Scope

**Skip if** description already has clear scope, user stories, and success criteria.

Use AskUserQuestion to understand or refine the scope:

```
What are we building with this bead? The current description says:

> [quote existing description]

Is this accurate, or should we refine it?
```

Based on their response, ask 1-2 clarifying questions if needed:
- "What's in scope vs. out of scope?"
- "What's the expected outcome when this is done?"
- "Are there constraints I should know about?"

### Step 3: Gather Visuals

**Skip if** notes already reference visuals or the work is purely backend.

Use AskUserQuestion:

```
Do you have any visuals to reference?

- Mockups or wireframes
- Screenshots of similar features
- Examples from other apps

(Paste images, share file paths, or say "none")
```

If visuals are provided, note them for inclusion in the bead's notes.

### Step 4: Identify Reference Implementations

**Skip if** notes already reference similar code.

Use AskUserQuestion:

```
Is there similar code in this codebase I should reference?

Examples:
- "The comments feature is similar"
- "Look at how src/server/calendar/service/ handles events"
- "No existing references"
```

If references are provided, read and analyze them to inform the design.

### Step 5: Check Product Context

Read `agent-os/product/mission.md` and `agent-os/product/roadmap.md`.

Use AskUserQuestion:

```
I found product context. Should this bead align with any specific product goals?

Key points:
- [summarize relevant roadmap items]

(Confirm alignment or note adjustments)
```

### Step 6: Surface Relevant Standards

Read `.claude/skills/standards-routing/index.yml` to identify relevant standards based on the work.

Use AskUserQuestion to confirm:

```
Based on what we're building, these standards may apply:

1. **backend/api** — RESTful API design
2. **backend/service-layer** — Business logic patterns
3. **frontend/components** — Vue component conventions

Should I include these? (yes / adjust: remove 3, add testing/test-writing)
```

Read the confirmed standards files to inform the design.

### Step 7: Draft Technical Design

**Skip if** design field already has a solid technical approach.

Based on the scope, references, and standards gathered, draft a technical design:

- Approach and patterns to follow
- Key files to create or modify
- Integration points with existing code
- Any new dependencies needed

Present the draft to the user for confirmation before writing.

### Step 8: Draft Acceptance Criteria

**Skip if** acceptance field already has a testable checklist.

Draft testable acceptance criteria:

```
Here are the acceptance criteria I'd suggest:

- [ ] [Testable criterion 1]
- [ ] [Testable criterion 2]
- [ ] [Testable criterion 3]
- [ ] All relevant tests pass

Does this look right?
```

### Step 9: Advisory Review

After the design and acceptance criteria are drafted, consult advisory sub-agents to evaluate the formed plan for potential issues. The advisors review the complete picture — scope, technical design, and acceptance criteria — to catch problems before code is written.

**Step 9a: Discover and select applicable advisors**

Discover all available advisor agents dynamically:

```bash
ls .claude/agents/*-advisor.md
```

Read each advisor's frontmatter `description` to understand what it reviews and when it applies. Match advisors to the bead based on what the work involves — e.g., an advisor whose description mentions "security" is relevant if the bead touches auth, APIs, or data storage; one mentioning "privacy" is relevant if PII handling is involved.

**Step 9b: Run matched advisors in parallel using the Task tool**

Since no spec files exist for beads, provide the full bead plan inline in each advisor's prompt. Use this template, adapted to each advisor's focus area:

> Review this bead's implementation plan for [advisor's focus area]. The design is fully formed but no code has been written yet.
>
> **Bead ID:** [id]
> **Title:** [title]
> **Description:** [description field content — scope, user stories, success criteria]
> **Technical Design:** [design field content from Step 7 — approach, patterns, files, decisions]
> **Acceptance Criteria:** [acceptance field content from Step 8]
> **Applicable Standards:** [from Step 6]
> **Product Context:** [alignment notes from Step 5]
>
> Adapt your normal review process to work with bead fields rather than spec documents.

**Step 9c: Present findings to user**

After receiving advisor reports:

If any advisor returns "REQUEST CHANGES" or "APPROVE WITH CONDITIONS":
- Present the concerns clearly to the user via AskUserQuestion
- Ask how they'd like to address each concern (adjust scope, modify design, add acceptance criteria, accept risk)
- Incorporate agreed adjustments into the relevant field drafts before writing to the bead

If all advisors return "APPROVE":
- Briefly note this to the user ("Advisory review passed — no concerns flagged") and proceed

### Step 10: Write to Bead

After all fields are confirmed, update the bead using `bd update`:

```bash
# Update description (what/why, scope, user stories, success criteria)
bd update <bead-id> --description="## Overview
[What we're building and why]

## Scope
- In scope: [list]
- Out of scope: [list]

## User Stories
[If applicable]

## Success Criteria
[High-level outcomes]"

# Update design (how — technical approach, patterns, files)
bd update <bead-id> --design="## Approach
[Technical approach]

## Patterns
[Standards and patterns to follow]

## Key Files
- [path] — [what changes]

## Decisions
- [Key technical decisions made during shaping]"

# Update acceptance (testable checklist)
bd update <bead-id> --acceptance="- [ ] [Criterion 1]
- [ ] [Criterion 2]
- [ ] All relevant tests pass"

# Append context to notes (references, standards, visuals, advisory review)
bd update <bead-id> --append-notes="## References
- [Reference 1]: [path] — [relevance]

## Applicable Standards
- backend/api — [why]
- testing/test-writing — [why]

## Visuals
- [Visual references if any]

## Advisory Review
[For each advisor that was run, record:]
- **[advisor-name]:** [APPROVE / APPROVE WITH CONDITIONS / REQUEST CHANGES / N/A] — [key findings or 'no concerns']
- **Decisions from review:** [any adjustments made based on advisor feedback]"

# Add shaped label
bd update <bead-id> --add-label shaped
```

**Important:** Write each field with a separate `bd update` call. Don't combine them into one command — it's clearer and easier to debug.

### Step 11: Validate Readiness

Read back the bead to verify all fields are populated:

```bash
bd show <bead-id>
```

Check:
- [ ] Description has overview, scope, and success criteria
- [ ] Design has approach, patterns, and key files
- [ ] Acceptance has testable checklist
- [ ] Notes have references and applicable standards
- [ ] `shaped` label is present

### Step 12: Decision Point — Continue or Stop

Use AskUserQuestion to ask the user:

```
Bead <bead-id> is fully shaped.

1. **Continue to decompose + analyze** — Break into epic hierarchy and
   enrich leaves with implementation context (recommended for multi-file features)
2. **Stop here** — This bead is small enough to implement directly
```

**Default recommendation:** Recommend "continue" if the design mentions 4+ files or spans backend + frontend. Recommend "stop" if it's a single-concern change touching 1-3 files.

If the user chooses **"Stop here"**, present a summary and exit:

```
Bead <bead-id> is shaped and ready for direct implementation.

### Fields Populated
- **Description:** [summary of what/why]
- **Design:** [summary of approach]
- **Acceptance:** [count] testable criteria
- **Notes:** [count] references, [count] standards
- **Advisory Review:** [verdicts from matched advisors]
- **Label:** shaped

### Next Step
This bead is small enough to implement directly. Start work with:
  bd update <bead-id> --status=in_progress
```

If the user chooses **"Continue"**, proceed to Step 13.

### Step 13: Decompose into Epic Hierarchy

Use the Task tool to spawn a general-purpose subagent:

**Prompt:**

> Read `.claude/commands/agent-os/decompose-bead.md` and follow its full
> process for bead `<bead-id>`.
>
> The bead is already shaped (has description, design, acceptance, notes,
> and the `shaped` label). Start from Phase 2 (Analyze Content) since
> Phase 1 (Read and Validate) is already satisfied.
>
> **Autonomous mode:** Make best-guess decisions about hierarchy structure.
> Only ask if a work area is genuinely ambiguous. Prefer action over questions.
>
> When done, report the hierarchy structure and list of ready beads.

Wait for the subagent to complete. Capture the epic ID and hierarchy from its output.

### Step 14: Analyze Bead

Use the Task tool to spawn a general-purpose subagent:

**Prompt:**

> Read `.claude/commands/agent-os/analyze-bead.md` and follow its full
> process for bead `<epic-id>`.
>
> The bead already has children and leaves from decomposition. Skip
> Phase 1.5 (Assess Structure & Decomposition Need) — children are confirmed
> to exist. Start from Phase 2 (Map the Hierarchy).
>
> **Autonomous mode:** Proceed through all leaves without pausing.
> Flag any issues in the completion report rather than stopping to ask.
>
> When done, report the execution waves and confirm all leaves have
> implementation context in their notes.

Wait for completion. Capture the execution waves summary.

### Step 15: Report Completion

Present the combined output from both subagents:

```
## Feature Preparation Complete

**Bead:** <bead-id> — [Title]
**Type:** Epic (promoted from task during decomposition)

### Hierarchy
[from decompose subagent output]

### Execution Waves
[from analyze subagent output]

### Ready to Start
[leaf beads with no blockers]

### Next Step
Run `/spawn-bead-workers <epic-id>` to begin parallel execution.
```

## Bead Field Mapping

| Bead Field | Equivalent Spec Artifact | Content |
|-----------|-------------------------|---------|
| `description` | spec.md overview + scope | What, why, in/out of scope, user stories |
| `design` | technical-spec.md | How — approach, patterns, files, decisions |
| `acceptance` | tests.md criteria | Testable done checklist |
| `notes` | references.md + standards.md | Context, references, applicable standards |
| `shaped` label | spec review complete | Machine-readable readiness signal |

## Tips

- **Assess before asking** — Don't re-ask questions the bead already answers
- **Keep shaping fast** — 5-10 minutes, not an hour
- **Small beads may not need design** — If the work is obvious (bug fix, simple change), a clear description and acceptance criteria may suffice
- **Standards guide, not dictate** — They inform the approach but aren't always mandatory
- **Visuals are optional** — Not every bead needs mockups
