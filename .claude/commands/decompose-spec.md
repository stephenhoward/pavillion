# Spec Decomposition Process

> **DEPRECATED:** Shape commands (`/shape-spec`, `/shape-bead`) now auto-decompose via subagent. Use `/decompose-bead` for manual decomposition. This command still works for existing specs in `agent-os/specs/`.

Break down a spec into an epic/bead hierarchy with proper sizing and dependencies.

## Overview

This command takes a completed spec and creates a hierarchy of beads:
- **Epic** - Top-level container linked to the spec
- **Children** - Major work areas or features
- **Leaves** - Agent-sized tasks (30-60 min work, no compaction risk)

## Prerequisites

- A spec exists with `plan.md` and optionally `requirements.md`
- The `bd` CLI is available for bead management

## Process

### PHASE 1: Locate the Spec

IF the user has specified a spec path, use that.

OTHERWISE, find the most recent spec:
```bash
ls -la agent-os/specs/ | tail -5
```

Read the spec's `plan.md` and `planning/requirements.md` (if present).

If no spec found, output:
```
I need a spec to decompose. Please either:
1. Point me to a spec folder: `/decompose-spec agent-os/specs/2026-02-05-feature-name`
2. Create a spec first: `/shape-spec` then `/write-spec`
```

### PHASE 2: Analyze the Spec

Read and analyze:
- `agent-os/specs/[spec-folder]/plan.md`
- `agent-os/specs/[spec-folder]/planning/requirements.md` (if exists)
- `agent-os/specs/[spec-folder]/planning/visuals/` (if exists)

Identify:
1. **Major work areas** - These become child beads under the epic
2. **Dependencies between areas** - Which must complete before others
3. **Individual tasks** - These become leaf beads
4. **Technical requirements** - Backend, frontend, database, tests

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
- Work has natural phases (data model → API → UI)

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

### PHASE 4: Create the Epic

Create the top-level epic:

```bash
bd create --title="[Spec Title]" --type=epic --priority=2 \
  --description="Implementation of agent-os/specs/[spec-folder]/plan.md

## Overview
[Brief summary from spec]

## Scope
[Key deliverables from spec]

## Success Criteria
[From spec's expected deliverables]"
```

Note the epic ID returned (e.g., `beads-042`).

### PHASE 5: Create Child Beads

For each major work area, create a child bead using `--parent` to link it to the epic.
The `--parent` flag automatically assigns hierarchical dot-notation IDs (e.g., `beads-042.1`, `beads-042.2`).

```bash
bd create --title="[Work Area Name]" --type=task --priority=2 \
  --parent=beads-[epic-id] \
  --description="[Description of this work area]

## Deliverables
- [Specific deliverable 1]
- [Specific deliverable 2]"
```

Note the child ID returned (e.g., `beads-042.1`).

### PHASE 6: Create Leaf Beads

For each leaf task, create a bead using `--parent` to link it to its child bead.
This produces nested dot-notation IDs (e.g., `beads-042.1.1`, `beads-042.1.2`).

```bash
bd create --title="[Specific Task]" --type=task --priority=2 \
  --parent=beads-[child-id] \
  --description="[Clear description of what to implement]

## Files to Modify
- src/server/[path]/[file].ts
- src/[path]/[file].ts

## Acceptance Criteria
- [ ] [Testable criterion 1]
- [ ] [Testable criterion 2]
- [ ] All tests pass

## Technical Notes
[Any specific implementation guidance]"
```

**If a leaf belongs directly to the epic (no intermediate child),** use the epic as parent:
```bash
bd create --title="[Task]" --type=task --priority=2 \
  --parent=beads-[epic-id] \
  --description="..."
```

### PHASE 7: Establish Dependencies

The `--parent` flag already establishes the structural hierarchy (parent-child relationships).
Dependencies (`bd dep add`) express **ordering constraints between siblings or across branches** —
i.e., which beads must finish before others can start.

```bash
# Child blocked by another child (ordering between siblings)
bd dep add beads-[id].2 beads-[id].1

# Leaf blocked by another leaf within the same child
bd dep add beads-[id].1.2 beads-[id].1.1

# Leaf blocked by a leaf in a different child (cross-branch)
bd dep add beads-[id].2.1 beads-[id].1.2
```

**Common dependency patterns:**

```
# Frontend waits for backend
bd dep add beads-[id].2 beads-[id].1

# API endpoint waits for service layer
bd dep add beads-[id].1.2 beads-[id].1.1

# Integration tests wait for implementation
bd dep add beads-[id].3 beads-[id].2
```

**Note:** Do NOT use `bd dep add` for parent-child relationships — that's what `--parent` is for.

### PHASE 8: Verify and Report

Verify the hierarchy:
```bash
bd show <epic-id>
bd ready
```

Output summary to user:

```
## Spec Decomposition Complete

**Epic Created:** beads-[id] - [Title]
**Spec:** agent-os/specs/[spec-folder]/plan.md

### Hierarchy (dot-notation IDs)

beads-[id]: [Epic Title]
├── beads-[id].1: [Child 1 Title]
│   ├── beads-[id].1.1: [Leaf Title] ✅ READY
│   └── beads-[id].1.2: [Leaf Title] (blocked by [id].1.1)
├── beads-[id].2: [Child 2 Title] (blocked by [id].1)
│   └── beads-[id].2.1: [Leaf Title]
└── ...

### Ready to Start
These beads have no blockers and can begin immediately:
- beads-[id].1.1: [Title]
- beads-[id].x.y: [Title]

### Next Steps
Run `/analyze-bead beads-[id]` to generate enriched context for each bead, then `/spawn-bead-workers` to begin parallel execution.
```

## Decomposition Guidelines

### Asking for Clarification

If the spec is ambiguous about breakdown, use AskUserQuestion:

```
The spec mentions "[feature]" but I'm unsure how to split it. Options:

1. **Single leaf** - If it's a small, bounded change
2. **Backend + Frontend split** - If it has both API and UI work
3. **Research + Implementation** - If it needs investigation first

Which approach fits your intent?
```

### Handling Large Specs

For specs with many features:
- Create one epic per major feature area
- Or create a "meta-epic" with feature epics as children
- Ask user preference if unclear

### Handling Unclear Scope

If a task's scope is unclear, create it as a child (not leaf) with a note:
```
--description="[Description]

⚠️ SCOPE TBD: This bead may need further decomposition once implementation begins. If it proves too large, split into leaves before starting work."
```

## Example Decomposition

**Input spec:** "Add event category filtering to public calendar"

**Output hierarchy (dot-notation IDs via --parent flag):**

```
beads-100: Add Event Category Filtering (EPIC)
│
├── beads-100.1: Backend Filter API
│   ├── beads-100.1.1: Add category filter params to events query [READY]
│   │   Files: src/server/calendar/service/event.ts
│   │   Criteria: Service accepts category[] param, filters correctly
│   │
│   └── beads-100.1.2: Expose filter params in public API (blocked by 100.1.1)
│       Files: src/server/public/api/v1/events.ts
│       Criteria: GET /events accepts ?category= param
│
├── beads-100.2: Frontend Filter UI (blocked by 100.1)
│   ├── beads-100.2.1: Create CategoryFilter component
│   │   Files: src/site/components/CategoryFilter.vue
│   │   Criteria: Multi-select UI, emits selected categories
│   │
│   ├── beads-100.2.2: Integrate filter into calendar view (blocked by 100.2.1)
│   │   Files: src/site/components/CalendarView.vue
│   │   Criteria: Filter component shown, selection triggers API call
│   │
│   └── beads-100.2.3: URL parameter persistence (blocked by 100.2.2)
│       Files: src/site/composables/useFilterParams.ts
│       Criteria: Filter state syncs with URL, bookmarkable
│
└── beads-100.3: E2E Tests (blocked by 100.2)
    └── beads-100.3.1: Playwright tests for filtering
        Files: e2e/public-calendar-filter.spec.ts
        Criteria: Tests filter selection, URL persistence, results
```

**Commands that produced this hierarchy:**
```bash
# Epic
bd create --title="Add Event Category Filtering" --type=epic --priority=2 --description="..."
# → beads-100

# Children (--parent points to epic)
bd create --title="Backend Filter API" --type=task --priority=2 --parent=beads-100 --description="..."
# → beads-100.1
bd create --title="Frontend Filter UI" --type=task --priority=2 --parent=beads-100 --description="..."
# → beads-100.2
bd create --title="E2E Tests" --type=task --priority=2 --parent=beads-100 --description="..."
# → beads-100.3

# Leaves (--parent points to child)
bd create --title="Add category filter params to events query" --type=task --priority=2 --parent=beads-100.1 --description="..."
# → beads-100.1.1
bd create --title="Expose filter params in public API" --type=task --priority=2 --parent=beads-100.1 --description="..."
# → beads-100.1.2

# Dependencies (separate from hierarchy)
bd dep add beads-100.1.2 beads-100.1.1   # API waits for service
bd dep add beads-100.2 beads-100.1       # Frontend waits for backend
bd dep add beads-100.3 beads-100.2       # E2E waits for frontend
```
