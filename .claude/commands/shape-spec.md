# Shape Spec

Gather context and structure planning for significant work, then output to a bead. **Run this command while in plan mode.**

## Important Guidelines

- **Always use AskUserQuestion tool** when asking the user anything
- **Offer suggestions** — Present options the user can confirm, adjust, or correct
- **Keep it lightweight** — This is shaping, not exhaustive documentation
- **Output to bead** — All shaped content writes to bead fields, not spec folders

## Prerequisites

This command **must be run in plan mode**.

**Before proceeding, check if you are currently in plan mode.**

If NOT in plan mode, **stop immediately** and tell the user:

```
Shape-spec must be run in plan mode. Please enter plan mode first, then run /shape-spec again.
```

Do not proceed with any steps below until confirmed to be in plan mode.

## Process

### Step 1: Clarify What We're Building

Use AskUserQuestion to understand the scope:

```
What are we building? Please describe the feature or change.

(Be as specific as you like — I'll ask follow-up questions if needed)
```

Based on their response, ask 1-2 clarifying questions if the scope is unclear. Examples:
- "Is this a new feature or a change to existing functionality?"
- "What's the expected outcome when this is done?"
- "Are there any constraints or requirements I should know about?"

### Step 2: Gather Visuals

Use AskUserQuestion:

```
Do you have any visuals to reference?

- Mockups or wireframes
- Screenshots of similar features
- Examples from other apps

(Paste images, share file paths, or say "none")
```

If visuals are provided, note them for inclusion in the bead's notes.

### Step 3: Identify Reference Implementations

Use AskUserQuestion:

```
Is there similar code in this codebase I should reference?

Examples:
- "The comments feature is similar to what we're building"
- "Look at how src/features/notifications/ handles real-time updates"
- "No existing references"

(Point me to files, folders, or features to study)
```

If references are provided, read and analyze them to inform the plan.

### Step 4: Check Product Context

Check if `agent-os/product/` exists and contains files.

If it exists, read key files (like `mission.md`, `roadmap.md`, `tech-stack.md`) and use AskUserQuestion:

```
I found product context in agent-os/product/. Should this feature align with any specific product goals or constraints?

Key points from your product docs:
- [summarize relevant points]

(Confirm alignment or note any adjustments)
```

If no product folder exists, skip this step.

### Step 5: Surface Relevant Standards

Read `.claude/skills/standards-routing/index.yml` to identify relevant standards based on the feature being built.

Use AskUserQuestion to confirm:

```
Based on what we're building, these standards may apply:

1. **api/response-format** — API response envelope structure
2. **api/error-handling** — Error codes and exception handling
3. **database/migrations** — Migration patterns

Should I include these in the bead's notes? (yes / adjust: remove 3, add frontend/forms)
```

Read the confirmed standards files to include their content in the plan context.

### Step 6: Draft Technical Design

Based on the scope, references, and standards gathered, draft a technical design:

- Approach and patterns to follow
- Key files to create or modify
- Integration points with existing code
- Any new dependencies needed

Present the draft to the user for confirmation before writing.

### Step 7: Draft Acceptance Criteria

Draft testable acceptance criteria:

```
Here are the acceptance criteria I'd suggest:

- [ ] [Testable criterion 1]
- [ ] [Testable criterion 2]
- [ ] [Testable criterion 3]
- [ ] All relevant tests pass

Does this look right?
```

### Step 8: Advisory Review

After the design and acceptance criteria are drafted, consult advisory sub-agents to evaluate the formed plan for potential issues. The advisors review the complete picture — scope, technical design, and acceptance criteria — to catch problems before code is written.

**Step 8a: Discover and select applicable advisors**

Discover all available advisor agents dynamically:

```bash
ls .claude/agents/*-advisor.md
```

Read each advisor's frontmatter `description` to understand what it reviews and when it applies. Match advisors to the feature based on what the work involves — e.g., an advisor whose description mentions "security" is relevant if the feature touches auth, APIs, or data storage; one mentioning "privacy" is relevant if PII handling is involved.

**Step 8b: Run matched advisors in parallel using the Task tool**

Provide the full plan inline in each advisor's prompt. Use this template, adapted to each advisor's focus area:

> Review this implementation plan for [advisor's focus area]. The plan is fully formed but no code has been written yet.
>
> **Feature:** [scope summary from Step 1]
> **Product Context:** [alignment notes from Step 4]
> **Applicable Standards:** [from Step 5]
> **Reference Implementations:** [patterns identified in Step 3]
> **Technical Design:** [design from Step 6]
> **Acceptance Criteria:** [from Step 7]
>
> Adapt your normal review process to work with an implementation plan rather than a completed spec.

**Step 8c: Present findings to user**

After receiving advisor reports:

If any advisor returns "REQUEST CHANGES" or "APPROVE WITH CONDITIONS":
- Present the concerns clearly to the user via AskUserQuestion
- Ask how they'd like to address each concern (adjust scope, modify design, add acceptance criteria, accept risk)
- Incorporate agreed adjustments into the relevant field drafts before writing to the bead
- Note advisor findings and decisions for inclusion in bead notes

If all advisors return "APPROVE":
- Briefly note this to the user ("Advisory review passed — no concerns flagged") and proceed

### Step 9: Create Bead and Write Fields

Create a new bead and populate all structured fields from the shaping work:

```bash
# Create the bead
bd create --title="[Feature Title]" --type=task --priority=2 --silent
# Capture the bead ID from output

# Write description (what/why, scope, user stories, success criteria)
bd update <id> --description="## Overview
[What we're building and why]

## Scope
- In scope: [list]
- Out of scope: [list]

## User Stories
[If applicable]

## Success Criteria
[High-level outcomes]"

# Write design (how — technical approach, patterns, files)
bd update <id> --design="## Approach
[Technical approach from Step 6]

## Patterns
[Standards and patterns to follow]

## Key Files
- [path] — [what changes]

## Decisions
- [Key technical decisions made during shaping]"

# Write acceptance (testable checklist)
bd update <id> --acceptance="- [ ] [Criterion 1]
- [ ] [Criterion 2]
- [ ] All relevant tests pass"

# Append context to notes (references, standards, visuals, advisory review)
bd update <id> --append-notes="## References
- [Reference 1]: [path] — [relevance]

## Applicable Standards
- [standard] — [why]

## Visuals
- [Visual references if any]

## Advisory Review
[For each advisor that was run, record:]
- **[advisor-name]:** [APPROVE / APPROVE WITH CONDITIONS / REQUEST CHANGES / N/A] — [key findings or 'no concerns']
- **Decisions from review:** [any adjustments made based on advisor feedback]"

# Add shaped label
bd update <id> --add-label shaped
```

**Important:** Write each field with a separate `bd update` call. Don't combine them into one command.

### Step 10: Validate Readiness

Read back the bead to verify all fields are populated:

```bash
bd show <id>
```

Check:
- [ ] Description has overview, scope, and success criteria
- [ ] Design has approach, patterns, and key files
- [ ] Acceptance has testable checklist
- [ ] Notes have references and applicable standards
- [ ] `shaped` label is present

### Step 11: Decision Point — Continue or Stop

Use AskUserQuestion to ask the user:

```
Bead <id> is fully shaped.

1. **Continue to decompose + analyze** — Break into epic hierarchy and
   enrich leaves with implementation context (recommended for multi-file features)
2. **Stop here** — This bead is small enough to implement directly
```

**Default recommendation:** Recommend "continue" if the design mentions 4+ files or spans backend + frontend. Recommend "stop" if it's a single-concern change touching 1-3 files.

If the user chooses **"Stop here"**, present a summary and exit:

```
Bead <id> is shaped and ready for direct implementation.

### Fields Populated
- **Description:** [summary of what/why]
- **Design:** [summary of approach]
- **Acceptance:** [count] testable criteria
- **Notes:** [count] references, [count] standards
- **Advisory Review:** [verdicts from matched advisors]
- **Label:** shaped

### Next Step
This bead is small enough to implement directly. Start work with:
  bd update <id> --status=in_progress
```

If the user chooses **"Continue"**, proceed to Step 12.

### Step 12: Decompose into Epic Hierarchy

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

### Step 13: Analyze Bead

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

### Step 14: Report Completion

Present the combined output from both subagents:

```
## Feature Preparation Complete

**Bead:** <id> — [Title]
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

| Bead Field | Content |
|-----------|---------|
| `description` | What, why, in/out of scope, user stories, success criteria |
| `design` | How — approach, patterns, files, decisions |
| `acceptance` | Testable done checklist |
| `notes` | Context: references, applicable standards, visuals, advisory review |
| `shaped` label | Machine-readable readiness signal |

## Tips

- **Keep shaping fast** — Don't over-document. Capture enough to start, refine as you build.
- **Visuals are optional** — Not every feature needs mockups.
- **Standards guide, not dictate** — They inform the plan but aren't always mandatory.
- **Subagents get fresh context** — Decompose and analyze run with clean context, reading the command files directly.
