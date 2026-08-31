# Decompose Bead

Break a shaped bead into an epic/bead hierarchy with proper sizing and dependencies. Reads from bead fields instead of spec files.

## Overview

This command takes a bead with populated fields (from `/plan`'s DRAFT phase) and creates a hierarchy:
- **Epic** — The original bead, promoted to epic type
- **Children** — Major work areas or features
- **Leaves** — Agent-sized tasks (30-60 min work, no compaction risk)

## Prerequisites

- A bead exists with populated `description`, `design`, and `acceptance` fields
- The `bd` CLI is available for bead management

## Arguments

The user should provide a bead ID: `/decompose-bead beads-XXX`

If no bead ID is provided:
```bash
bd list --status=open --limit=10
```

Ask the user which bead to decompose.

## Process

### PHASE 1: Read and Validate

Read the bead:
```bash
bd show <bead-id>
```

Check that structured fields are populated:

| Field | Required | What to Check |
|-------|----------|---------------|
| `description` | Yes | Has overview, scope, or user stories |
| `design` | Yes | Has approach, patterns, or files |
| `acceptance` | Yes | Has testable criteria |

**If fields are missing**, tell the user:

```
Bead <bead-id> is missing structured content needed for decomposition:

- [x] Description: [present/missing]
- [x] Design: [present/missing]
- [x] Acceptance: [present/missing]

Run `/plan <bead-id>` first to fill these fields, then come back to decompose.
```

**If the bead has the `shaped` label**, proceed with confidence.

**If the bead lacks the `shaped` label but has content**, ask the user:

```
This bead hasn't been through /plan but has some content. Should I:

1. Proceed with decomposition using existing content
2. Run /plan first to fill any gaps
```

### PHASE 2: Analyze Content

Read and analyze the bead's structured fields:

- **From description:** Identify what's being built, scope boundaries, user stories
- **From design:** Identify technical approach, files to modify, patterns to follow
- **From acceptance:** Identify testable criteria that leaf beads must satisfy
- **From notes:** Identify references, standards, and context

Identify:
1. **Major work areas** — These become child beads under the epic
2. **Dependencies between areas** — Which must complete before others
3. **Individual tasks** — These become leaf beads
4. **Technical requirements** — Backend, frontend, database, tests

### PHASE 3: Design the Hierarchy

Create a hierarchy following these sizing rules:

**LEAF BEAD CRITERIA (must be completable by single agent):**
- Touches 1-3 related files
- Has clear, bounded scope
- Can be completed in 30-60 minutes of agent work (be conservative, smaller is better)
- Has testable acceptance criteria

**SPLIT INTO CHILDREN WHEN:**
- Work touches 4+ files
- Work spans unrelated concerns (backend + frontend)
- Work requires research before implementation
- Work has natural phases (data model -> API -> UI)

**COMMON PATTERNS:**

Feature with backend + frontend:
```
Epic: Implement [Feature]
├── Child: Backend Implementation
│   ├── Leaf: Database migration + entity
│   ├── Leaf: Service layer logic
│   └── Leaf: API endpoints + tests
└── Child: Frontend Implementation (blocked by Backend)
    ├── Leaf: Vue component
    ├── Leaf: Store/service integration
    └── Leaf: E2E tests
```

API-only feature:
```
Epic: Add [API Feature]
├── Leaf: Database changes (if any)
├── Leaf: Service method + unit tests
├── Leaf: API endpoint + integration tests
└── Leaf: Documentation updates
```

Refactoring work:
```
Epic: Refactor [Component]
├── Leaf: Add tests for current behavior
├── Leaf: Refactor part A
├── Leaf: Refactor part B (blocked by A if dependent)
└── Leaf: Update dependent code
```

### PHASE 4: Promote to Epic

Promote the original bead to epic type. This preserves all existing fields (description, design, acceptance, notes, labels):

```bash
bd update <bead-id> --type=epic
```

### PHASE 5: Create Child Beads

For each major work area, create a child bead using `--parent`:

```bash
bd create --title="[Work Area Name]" --type=task --priority=2 \
  --parent=<bead-id> \
  --description="[Description of this work area]

## Deliverables
- [Specific deliverable 1]
- [Specific deliverable 2]"
```

**Propagate context from the epic:** Each child should reference the parent's design and acceptance criteria where relevant. Don't duplicate the full content — just reference what applies.

### PHASE 6: Create Leaf Beads

For each leaf task, create a bead using `--parent` to link it to its child:

```bash
bd create --title="[Specific Task]" --type=task --priority=2 \
  --parent=<child-id> \
  --description="[Clear description of what to implement]

## Files to Modify
- src/server/[path]/[file].ts
- src/[path]/[file].ts

## Acceptance Criteria
- [ ] [Testable criterion 1]
- [ ] [Testable criterion 2]
- [ ] All tests pass

## Technical Notes
[Implementation guidance from parent's design field]"
```

**If a leaf belongs directly to the epic (no intermediate child),** use the epic as parent:
```bash
bd create --title="[Task]" --type=task --priority=2 \
  --parent=<bead-id> \
  --description="..."
```

### PHASE 7: Establish Dependencies

The `--parent` flag establishes structural hierarchy. Dependencies (`bd dep add`) express **ordering constraints between siblings or across branches**.

```bash
# Child blocked by another child
bd dep add <bead-id>.2 <bead-id>.1

# Leaf blocked by another leaf within same child
bd dep add <bead-id>.1.2 <bead-id>.1.1

# Cross-branch dependency
bd dep add <bead-id>.2.1 <bead-id>.1.2
```

**Common dependency patterns:**
```bash
# Frontend waits for backend
bd dep add <bead-id>.2 <bead-id>.1

# API endpoint waits for service layer
bd dep add <bead-id>.1.2 <bead-id>.1.1

# E2E tests wait for implementation
bd dep add <bead-id>.3 <bead-id>.2
```

**Note:** Do NOT use `bd dep add` for parent-child relationships — that's what `--parent` is for.

### PHASE 8: Verify and Report

Verify the hierarchy:
```bash
bd show <bead-id>
bd ready
```

Output summary to user:

```
## Bead Decomposition Complete

**Epic:** <bead-id> - [Title]
**Source:** Bead fields (shaped via /plan)

### Hierarchy

<bead-id>: [Epic Title] (EPIC)
├── <bead-id>.1: [Child 1 Title]
│   ├── <bead-id>.1.1: [Leaf Title] ✅ READY
│   └── <bead-id>.1.2: [Leaf Title] (blocked by .1.1)
├── <bead-id>.2: [Child 2 Title] (blocked by .1)
│   └── <bead-id>.2.1: [Leaf Title]
└── ...

### Ready to Start
These beads have no blockers and can begin immediately:
- <bead-id>.1.1: [Title]
- <bead-id>.x.y: [Title]

### Next Steps
Run `/analyze-bead <bead-id>` to generate enriched context for each bead, then `/spawn-bead-workers` to begin parallel execution.
```

## Decomposition Guidelines

### Asking for Clarification

If the bead's content is ambiguous about breakdown, use AskUserQuestion:

```
The bead's design mentions "[feature]" but I'm unsure how to split it. Options:

1. **Single leaf** — If it's a small, bounded change
2. **Backend + Frontend split** — If it has both API and UI work
3. **Research + Implementation** — If it needs investigation first

Which approach fits?
```

### Handling Large Beads

For beads with many work areas:
- Create one epic with multiple children
- Or suggest splitting into separate beads first, each getting their own `/plan` + `/decompose-bead` cycle

### Handling Unclear Scope

If a task's scope is unclear, create it as a child (not leaf) with a note:
```
--description="[Description]

⚠️ SCOPE TBD: This bead may need further decomposition once implementation begins. If it proves too large, split into leaves before starting work."
```

## Example Decomposition

**Input bead:** `beads-050` — "Add calendar directory page"

With fields:
- **Description:** Public page listing all calendars on the instance with metadata
- **Design:** New route in public app, service method to list public calendars, Vue component
- **Acceptance:** Page loads at /calendars, shows calendar names/descriptions, links to each calendar

**Output hierarchy:**

```
beads-050: Add Calendar Directory Page (EPIC)
│
├── beads-050.1: Backend - Public Calendar Listing API
│   ├── beads-050.1.1: Add listPublicCalendars service method [READY]
│   │   Files: src/server/public/service/calendar.ts
│   │   Criteria: Returns public calendars with content, ordered by name
│   │
│   └── beads-050.1.2: Add GET /api/public/v1/calendars endpoint (blocked by .1.1)
│       Files: src/server/public/api/v1/calendar-routes.ts
│       Criteria: Returns JSON array of public calendars
│
├── beads-050.2: Frontend - Calendar Directory Component (blocked by .1)
│   ├── beads-050.2.1: Create CalendarDirectory.vue component
│   │   Files: src/site/components/CalendarDirectory.vue
│   │   Criteria: Renders list of calendars with name, description, link
│   │
│   └── beads-050.2.2: Add route and navigation (blocked by .2.1)
│       Files: src/site/router.ts
│       Criteria: /calendars route works, navigation link visible
│
└── beads-050.3: Tests (blocked by .2)
    └── beads-050.3.1: Unit + integration tests
        Criteria: API returns correct data, component renders correctly
```

**Commands:**
```bash
# Promote to epic
bd update beads-050 --type=epic

# Children
bd create --title="Backend - Public Calendar Listing API" --type=task --priority=2 --parent=beads-050 --description="..."
# -> beads-050.1
bd create --title="Frontend - Calendar Directory Component" --type=task --priority=2 --parent=beads-050 --description="..."
# -> beads-050.2
bd create --title="Tests" --type=task --priority=2 --parent=beads-050 --description="..."
# -> beads-050.3

# Leaves
bd create --title="Add listPublicCalendars service method" --type=task --priority=2 --parent=beads-050.1 --description="..."
# -> beads-050.1.1
bd create --title="Add GET /api/public/v1/calendars endpoint" --type=task --priority=2 --parent=beads-050.1 --description="..."
# -> beads-050.1.2

bd create --title="Create CalendarDirectory.vue component" --type=task --priority=2 --parent=beads-050.2 --description="..."
# -> beads-050.2.1
bd create --title="Add route and navigation" --type=task --priority=2 --parent=beads-050.2 --description="..."
# -> beads-050.2.2

bd create --title="Unit + integration tests" --type=task --priority=2 --parent=beads-050.3 --description="..."
# -> beads-050.3.1

# Dependencies
bd dep add beads-050.1.2 beads-050.1.1   # API waits for service
bd dep add beads-050.2 beads-050.1       # Frontend waits for backend
bd dep add beads-050.2.2 beads-050.2.1   # Route waits for component
bd dep add beads-050.3 beads-050.2       # Tests wait for frontend
```
