# Bead Analysis Process

Analyze any bead — assess whether it needs decomposition, and generate enriched implementation context.

## Overview

This command front-loads analysis work so that subagents receive complete, standalone context. It:
1. Accepts any bead (not just epics)
2. Assesses whether the bead needs decomposition
3. If decomposition is warranted, invokes `/decompose-bead` first
4. Maps the full dependency hierarchy (if children exist)
5. Identifies which beads are READY (no blockers)
6. Generates enriched context for each leaf bead (or the single bead itself)
7. Outputs an analysis summary for orchestration

**Note:** This command ENRICHES beads with implementation context. It can also trigger decomposition when a bead is too large to implement directly.

## Prerequisites

- A bead exists in the beads system
- The bead has a description and ideally acceptance criteria
- Load the `epic-bead-workflow` skill for context

## Process

### PHASE 1: Get Bead ID

IF the user specified a bead ID, use that.

OTHERWISE, ask:
```
Which bead should I analyze?

Run `bd list --status=open` to see available beads, or provide the bead ID directly.
```

### PHASE 1.5: Assess Structure & Decomposition Need

**CRITICAL:** Before proceeding, determine whether this bead has children and whether it needs decomposition.

```bash
bd show <bead-id> --children
```

**Decision Tree:**

```
IF bead has child beads:
  COUNT the number of children
  ASK user:
    "This bead already has [count] child beads:

    [list first 5 bead titles with IDs]

    Would you like to:
    1. **Enrich existing beads** - Add implementation context to existing beads (recommended)
    2. **Delete and recreate** - Delete existing beads and create new decomposition
    3. **Cancel** - Stop analysis

    Choose option (1/2/3):"

  WAIT for user response

  IF user chooses 1 (Enrich):
    SET analysis_mode = "hierarchy"
    PROCEED to Phase 2 with existing beads

  ELSE IF user chooses 2 (Delete and recreate):
    ASK for confirmation:
      "This will permanently delete [count] beads. Are you sure? (yes/no)"
    IF confirmed:
      DELETE all child beads: `bd delete <child-ids>`
      SET analysis_mode = "needs_decomposition"
      PROCEED to decomposition assessment below

  ELSE IF user chooses 3 (Cancel):
    STOP analysis
    MESSAGE: "Analysis cancelled."

ELSE (no children):
  PROCEED to decomposition assessment below
```

**Decomposition Assessment (for beads with no children):**

1. Read the bead's structured fields:
   ```bash
   bd show <bead-id>
   ```
   Examine: description, design, acceptance criteria, notes

2. Search the codebase for scope indicators based on the bead's description:
   - Which files/domains would need modification?
   - Does the work span backend + frontend?
   - Are there multiple independent deliverables?

3. Apply decomposition criteria — the bead likely needs decomposition if **2 or more** of these are true:
   - Touches 4+ files across different concerns (e.g., entity + service + API + component)
   - Spans both backend and frontend changes
   - Has multiple independent deliverables (e.g., "add filtering AND sorting AND search")
   - Estimated > 60 minutes of agent work

4. Make recommendation:

```
IF decomposition criteria met:
  MESSAGE: "This bead is complex enough to benefit from decomposition:
    - [list which criteria were met]

    I recommend running /decompose-bead first to break it into manageable pieces.

    Would you like to:
    1. **Decompose first** - Run /decompose-bead, then analyze the resulting hierarchy (recommended)
    2. **Analyze as-is** - Enrich this single bead without decomposing
    3. **Cancel** - Stop analysis

    Choose option (1/2/3):"

  IF user chooses 1:
    RUN /decompose-bead <bead-id>
    WAIT for decomposition to complete
    SET analysis_mode = "hierarchy"
    PROCEED to Phase 2

  ELSE IF user chooses 2:
    SET analysis_mode = "single"
    PROCEED to Phase 4b (Single Bead Enrichment)

  ELSE IF user chooses 3:
    STOP analysis

ELSE (decomposition NOT needed):
  SET analysis_mode = "single"
  PROCEED to Phase 4b (Single Bead Enrichment)
```

### PHASE 2: Map the Hierarchy

**Only runs when `analysis_mode = "hierarchy"`**

Get the full bead structure:

```bash
bd show <bead-id>
```

Build a mental model of:
- All child beads (direct children of the parent bead)
- All leaf beads (beads with no children)
- All dependency relationships (what blocks what)
- Current status of each bead

Create a dependency graph visualization:

```
beads-100: [Parent Title]
|
+-- beads-100.1: [Child A]
|   +-- beads-100.1.1: [Leaf] READY
|   +-- beads-100.1.2: [Leaf] blocked by 100.1.1
|
+-- beads-100.2: [Child B] blocked by 100.1
|   +-- beads-100.2.1: [Leaf]
|   +-- beads-100.2.2: [Leaf] blocked by 100.2.1
|
+-- beads-100.3: [Child C] blocked by 100.2
    +-- beads-100.3.1: [Leaf]
```

### PHASE 3: Identify Ready Beads

**Only runs when `analysis_mode = "hierarchy"`**

A bead is READY when:
- Status is `open` or `pending` (not `in_progress` or `completed`)
- All beads it depends on are `completed`
- It is a LEAF (has no children that need completing first)

```bash
bd ready
```

Cross-reference with the hierarchy to identify ready leaves.

### PHASE 4: Analyze Each Leaf Bead

**Only runs when `analysis_mode = "hierarchy"`**

For each LEAF bead in the hierarchy (starting with ready ones), generate enriched context.

**4a. Read the bead details:**
```bash
bd show <bead-id>
```

**4b. Identify broader context:**
- Check parent bead description for context references (spec links, design notes, etc.)
- Read any linked documents for broader context

**4c. Analyze the codebase to determine:**

**Files to modify:**
- Parse the bead description for file hints
- Search codebase for related files:
  ```
  # If bead mentions "event filtering"
  Search for: event, filter in src/server/ and src/site/
  ```
- Identify the domain(s) involved
- List specific file paths

**Relevant tests:**
- Find existing test files for the affected code
- Identify test patterns used in similar features
- Note which test types are needed (unit, integration, e2e)

**Applicable skills:**

Discover available skills by listing `.claude/skills/` and reading the frontmatter `description` from each `SKILL.md`. Match skills to the bead based on what the bead's work involves:

```bash
# List all available skills
ls .claude/skills/

# Read a skill's description to check relevance
head -5 .claude/skills/<skill-name>/SKILL.md
```

Select skills whose descriptions match the bead's scope (e.g. a bead modifying API routes should get skills whose descriptions mention API work, route handlers, etc.).

**Applicable standards:**

Discover available standards by reading `.claude/skills/standards-routing/index.yml`. This file lists every standard with a short description. Match standards to the bead based on what the work touches:

```bash
cat .claude/skills/standards-routing/index.yml
```

Select standards whose descriptions are relevant to the bead's scope (e.g. a bead adding a database entity should get standards about entity-model separation, sequelize queries, etc.).

**Acceptance criteria:**
- Extract from bead description if present
- Derive from spec requirements
- Add standard criteria:
  - `npm run lint` passes
  - `npm test` passes (or relevant subset)
  - No regressions

**Estimated Complexity:**
- **Small:** Single file change, clear pattern exists, <30 min
- **Medium:** 2-3 files, some decisions needed, 30-60 min
- **Large:** Multiple files, new patterns, research needed, 60+ min

If a leaf is estimated as "large", consider whether it should be split further.

### PHASE 4b: Single Bead Enrichment

**Only runs when `analysis_mode = "single"`**

When a bead doesn't need decomposition, enrich just the one bead with implementation context. This follows the same enrichment logic as Phase 4 but applied to a single bead.

**4b.1. Read the bead details:**
```bash
bd show <bead-id>
```

**4b.2. Identify broader context:**
- Check if the bead references a spec or parent bead
- Read any linked documents for broader context

**4b.3. Analyze the codebase (same as Phase 4c):**
- **Files to modify:** Search codebase for related files, identify domains, list specific paths
- **Relevant tests:** Find existing test files, identify patterns, note test types needed
- **Applicable skills:** Discover from `.claude/skills/` frontmatter descriptions
- **Applicable standards:** Discover from `.claude/skills/standards-routing/index.yml`
- **Acceptance criteria:** Extract from bead, derive from requirements, add standard criteria

**4b.4. Store enrichment in bead notes:**

```bash
bd update <bead-id> --append-notes "$(cat <<'EOF'

# Implementation Context
Generated: [timestamp]

## Files to Modify
- `src/server/calendar/service/event.ts`
  Reason: Add category filter logic to query
- `src/server/calendar/service/event.test.ts`
  Reason: Add unit tests for filtering

## Relevant Tests
- Unit: `src/server/calendar/test/event.test.ts`
- Integration: `src/server/calendar/test/integration/events-api.test.ts`

## Skills to Apply
- backend-domain-structure
- backend-sequelize
- testing-test-writing

## Standards to Follow
- backend/service-layer
- backend/sequelize-queries
- testing/test-writing

## Acceptance Criteria
- [ ] Service method accepts category filter parameter
- [ ] Filtering returns only events with matching categories
- [ ] Empty filter returns all events (no filtering)
- [ ] Unit tests cover filter logic
- [ ] `npm run lint` passes
- [ ] `npm test` passes

## Estimated Complexity
small (< 30 min)
EOF
)"
```

**4b.5. Output summary and stop:**

Proceed directly to Phase 6 (Output Summary) with the single-bead format.

### PHASE 5: Store Analysis in Bead Notes

**Only runs when `analysis_mode = "hierarchy"`**

**5a. Update Parent Bead Notes with Structure Overview**

Add high-level analysis to the parent bead's notes field:

```bash
bd update <parent-bead-id> --append-notes "$(cat <<'EOF'

# Bead Analysis
Generated: [timestamp]

## Dependency Graph

[ASCII visualization from Phase 2]

## Execution Waves

### Wave 1 (Ready to Start)
Can be worked in parallel:
- beads-104: [Title] - Files: [...] - Complexity: small
- beads-106: [Title] - Files: [...] - Complexity: small

### Wave 2 (After Wave 1)
Unblocks after Wave 1 completes:
- beads-105: [Title] (blocked by beads-104)
- beads-107: [Title] (blocked by beads-106)

### Wave 3 (After Wave 2)
- beads-108: [Title] (blocked by beads-105)

## Implementation Summary
- Total leaf beads: [count]
- Ready to start: [count]
- Currently blocked: [count]
- Estimated total complexity: [small/medium/large]
EOF
)"
```

**5b. Update Each Leaf Bead with Implementation Context**

For each LEAF bead, add detailed implementation guidance to its notes:

```bash
bd update <bead-id> --append-notes "$(cat <<'EOF'

# Implementation Context
Generated: [timestamp]

## Files to Modify
- `src/server/calendar/service/event.ts`
  Reason: Add category filter logic to query
- `src/server/calendar/service/event.test.ts`
  Reason: Add unit tests for filtering

## Relevant Tests
- Unit: `src/server/calendar/test/event.test.ts`
- Integration: `src/server/calendar/test/integration/events-api.test.ts`

## Skills to Apply
- backend-domain-structure
- backend-sequelize
- testing-test-writing

## Standards to Follow
- backend/service-layer
- backend/sequelize-queries
- testing/test-writing

## Acceptance Criteria
- [ ] Service method accepts category filter parameter
- [ ] Filtering returns only events with matching categories
- [ ] Empty filter returns all events (no filtering)
- [ ] Unit tests cover filter logic
- [ ] `npm run lint` passes
- [ ] `npm test` passes

## Estimated Complexity
small (< 30 min)
EOF
)"
```

Repeat for each leaf bead in the hierarchy.

### PHASE 6: Output Summary

**For hierarchy mode (`analysis_mode = "hierarchy"`):**

```
## Bead Analysis Complete

**Bead:** beads-<id> - [Title]
**Spec:** agent-os/specs/[spec-folder]/spec.md (if linked)

### Dependency Graph

[ASCII visualization from Phase 2]

### Ready to Start (Wave 1)
These beads have no blockers and can be worked in parallel:

1. **beads-104:** [Title]
   - Files: src/server/calendar/service/event.ts
   - Skills: backend-domain-structure, testing-test-writing
   - Standards: backend/service-layer, testing/test-writing
   - Complexity: small

2. **beads-106:** [Title]
   - Files: src/site/components/CategoryFilter.vue
   - Skills: frontend-components, frontend-css
   - Standards: frontend/components, frontend/css, frontend/accessibility
   - Complexity: small

### Execution Waves

| Wave | Beads | Unblocks |
|------|-------|----------|
| 1 | beads-104, beads-106 | beads-105, beads-107 |
| 2 | beads-105, beads-107 | beads-102, beads-108 |
| 3 | beads-108 | beads-103 (complete) |

### Analysis Storage
- Parent bead notes updated with structure overview and execution waves
- [count] leaf beads updated with implementation context

### Next Steps
Run `/spawn-bead-workers beads-<id>` to begin parallel execution of Wave 1.
Each worker will receive complete context from the bead's notes field.
```

**For single bead mode (`analysis_mode = "single"`):**

```
## Bead Analysis Complete

**Bead:** beads-<id> - [Title]

### Implementation Context

- **Files:** [list of files to modify]
- **Tests:** [list of relevant test files]
- **Skills:** [matched skills]
- **Standards:** [matched standards]
- **Complexity:** [small/medium/large]

### Analysis Storage
- Bead notes updated with implementation context

### Next Steps
This bead is ready for direct implementation:
- Run `bd update beads-<id> --status=in_progress` to claim it
- Or use `/spawn-bead-workers` if it's part of a larger epic
```

## Context Enrichment Guidelines

### Finding Related Files

Use these search strategies:

```bash
# For API work - find the domain
grep -r "class.*Service" src/server/*/service/

# For specific functionality
grep -r "functionName\|ClassName" src/

# For Vue components
ls src/client/components/ src/site/components/

# For tests
find src -name "*.test.ts" | grep -i <keyword>
```

### Discovering Skills and Standards

Do NOT rely on hardcoded mappings. Instead, discover at runtime:

1. **Skills:** List `.claude/skills/` and read each `SKILL.md` frontmatter for its `description` field. Match descriptions to the bead's scope.
2. **Standards:** Read `.claude/skills/standards-routing/index.yml` for the full catalog with descriptions. Match descriptions to the bead's scope.

This ensures newly added or renamed skills and standards are automatically picked up.

### Estimating Complexity

- **Small:** Single file change, clear pattern exists, <30 min
- **Medium:** 2-3 files, some decisions needed, 30-60 min
- **Large:** Multiple files, new patterns, research needed, 60+ min

If a leaf is estimated as "large", consider whether it should be split further.

## Handling Issues

### Bead Description Too Vague

If a bead lacks detail for context enrichment:

```
**beads-XXX** has insufficient detail for context enrichment.

Current description: "[vague description]"

I recommend updating with:
- Specific files to modify
- Clear acceptance criteria
- Technical approach

Would you like me to:
1. Attempt analysis with available info
2. Skip this bead and flag for manual review
3. Help you update the bead description
```

### Circular Dependencies Detected

If dependency analysis reveals a cycle:

```
**Circular dependency detected:**

beads-104 -> blocks -> beads-105 -> blocks -> beads-104

This needs to be resolved before orchestration can proceed.

Options:
1. Remove one dependency: `bd dep remove <id> <dep-id>`
2. Split one bead to break the cycle
3. Review if these truly depend on each other
```

### Missing Spec Reference

If the bead has no linked spec:

```
**No spec linked to this bead.**

The bead description doesn't reference a spec document.
Context enrichment will rely solely on bead descriptions.

If a spec exists, consider updating the bead description:
`bd update <bead-id> --description="...existing description...

## Spec
agent-os/specs/[path]/spec.md"`
```
