# Epic and Bead Workflow Skill

This skill documents the patterns for working with epics and beads in this codebase. Follow these patterns whenever working with the `bd` CLI task management system.

## Core Principles

### 1. Always Map Dependencies First

Before starting ANY work on an epic:
1. Run `bd show <epic-id>` to see all blocking beads
2. Build a mental model of the dependency graph
3. Identify which beads are READY (no unresolved blockers)
4. Only work on READY beads - never skip ahead

**Wrong approach:**
```
User: "Work on epic beads-042"
Claude: *immediately starts implementing the epic directly*
```

**Correct approach:**
```
User: "Work on epic beads-042"
Claude: "Let me first analyze the dependency structure..."
*runs bd show beads-042*
*identifies blocking beads and their dependencies*
*reports which beads are ready to start*
```

### 2. Process Beads in Dependency Order

Beads form a directed acyclic graph (DAG). Work must flow through this graph:

```
Epic (beads-001)
    │
    ├── Child A (beads-002) ──blocks──▶ Child B (beads-003)
    │       │
    │       └── Leaf (beads-004) ◀── START HERE (no blockers)
    │
    └── Child C (beads-005)
            │
            └── Leaf (beads-006) ◀── CAN ALSO START (no blockers)
```

- Start with leaves that have no blockers
- When a bead completes, check what it unblocks
- Never work on a bead while its blockers are incomplete

### 3. Beads Are Self-Contained Work Packages

Each leaf bead should contain everything a subagent needs to implement it. The `/analyze-bead` command enriches bead notes with implementation context so subagents can work from the bead alone.

**What belongs in the bead's notes (added by `/analyze-bead`):**
- Files to modify (with reasons)
- Relevant existing tests
- Skills to apply
- Standards to follow
- Acceptance criteria
- Estimated complexity

**Delegating to a subagent is then minimal:**

```markdown
# Implement Bead: beads-XXX - [Title]

You are implementing a specific, scoped task as part of a larger epic.

Read your bead for full implementation context:
`bd show beads-XXX`

Your notes contain files to modify, skills, standards, and acceptance criteria.

On completion: `npm run lint && npm test && bd close beads-XXX`
```

**Implementers must refuse unenriched beads.** If an implementer runs `bd show` and the bead has no notes with implementation context, it must stop immediately and report back to the orchestrator. The implementer should not attempt to enrich the bead itself — that wastes implementation context on research work.

The orchestrator is responsible for ensuring beads are enriched before spawning implementers. If a bead lacks notes, the orchestrator should spawn an enrichment agent (or run `/analyze-bead`) to populate the notes, then retry with an implementer.

### 4. Proper Bead Sizing

Leaf beads should be sized for single-agent completion without context overflow:

**Good leaf size (30-60 min agent work):**
- Single API endpoint with tests
- Single Vue component
- Single service method with tests
- Database migration + entity update
- Bug fix with clear, bounded scope

**Too large (split into children):**
- "Implement authentication" → split into session, login, logout, reset beads
- "Add filtering feature" → split into backend API, frontend UI, URL persistence
- "Refactor domain X" → split by file or concern

**Splitting heuristic:**
- Touches 1-3 related files → LEAF
- Touches 4+ files or unrelated concerns → SPLIT
- Requires research before implementation → SPLIT into research bead + implementation bead(s)

### 5. Closing Beads Properly

Only close a bead when ALL of these are true:
- Implementation complete per acceptance criteria
- Lint passes (`npm run lint`)
- Tests pass (`npm test`)
- No regressions introduced

```bash
# Verify before closing
npm run lint && npm test && bd close beads-XXX
```

If tests fail or verification fails:
- Do NOT close the bead
- Fix the issues first
- Re-verify, then close

## Common Patterns

### Starting Work on an Epic

```bash
# 1. Get the full picture
bd show <epic-id>

# 2. Check what's ready
bd ready

# 3. Start with a ready leaf
bd update <ready-bead-id> --status=in_progress
```

### Completing a Bead and Cascading

```bash
# 1. Verify work
npm run lint
npm test

# 2. Close the bead
bd close <bead-id>

# 3. Check what's now unblocked
bd ready

# 4. Continue with next ready bead
```

### Creating Child Beads During Work

If you discover a bead is too large during implementation:

```bash
# 1. Create child beads
bd create --title="Part 1: Backend API" --type=task
bd create --title="Part 2: Frontend UI" --type=task

# 2. Set up dependencies
bd dep add <part2-id> <part1-id>  # Part 2 depends on Part 1

# 3. Link to parent
bd dep add <parent-id> <part1-id>
bd dep add <parent-id> <part2-id>
```

## Anti-Patterns to Avoid

### 1. Jumping Into Epic Work Directly
**Wrong:** Starting implementation without mapping dependencies
**Right:** Always run `bd show` first, identify the dependency graph

### 2. Working on Blocked Beads
**Wrong:** "I'll just start on beads-005 even though beads-003 isn't done"
**Right:** Only work on beads with no unresolved blockers

### 3. Unenriched Beads
**Wrong:** Spawning a subagent for a bead that has no implementation context in its notes
**Right:** Run `/analyze-bead` first so each bead's notes contain files, tests, skills, and acceptance criteria. The subagent reads its own bead.

### 4. Closing Before Verification
**Wrong:** `bd close` immediately after writing code
**Right:** Lint → Test → Verify acceptance criteria → Then close

### 5. Oversized Beads
**Wrong:** Single bead for "implement entire feature"
**Right:** Break into leaf beads sized for single-agent completion

## Integration with Agent OS Specs

When a spec exists in `agent-os/specs/`:

1. The spec provides the WHAT and WHY
2. Beads provide the HOW and WHEN (execution order)
3. Link epics to specs via bead description or notes
4. Reference spec.md in subagent context

```bash
# Create epic linked to spec
bd create --title="Implement [Feature Name]" --type=epic \
  --description="Implementation of agent-os/specs/2026-02-05-feature-name/spec.md"
```
