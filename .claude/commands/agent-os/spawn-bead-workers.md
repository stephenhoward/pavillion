# Bead Worker Orchestration

Spawn parallel subagents for dependency-ready beads with full enriched context.

## Critical Rule: Maximum 3 Parallel Agents

**NEVER spawn more than 3 subagents at once.** This is a hard limit to:
- Prevent system overload
- Keep orchestration manageable
- Ensure quality over speed

If more than 3 beads are ready, queue the extras and spawn them as slots free up.

## Overview

This command orchestrates the execution of an epic by:
1. Reading the epic structure and implementation context from bead notes (populated by `/analyze-bead`)
2. Spawning subagents for READY beads (max 3 at a time)
3. Monitoring completion and cascading to newly-unblocked beads
4. Running verification after each completion
5. Continuing until the epic is complete

## Prerequisites

- Epic has been analyzed: epic notes contain structure overview and leaf beads contain implementation context
- OR: Run `/analyze-bead <epic-id>` first to populate bead notes
- Load the `epic-bead-workflow` skill

## Process

### PHASE 1: Load Epic Analysis

IF an epic ID is provided:
1. Load the epic: `bd show <epic-id>`
2. Check if notes field contains "Epic Analysis" section
3. If missing, offer to run `/analyze-bead` first

IF no epic ID provided:
1. List open epics: `bd list --status=open --type=epic`
2. Ask user which epic to orchestrate

```
Available epics:

1. beads-100: Add Event Category Filtering
2. beads-150: User Profile Enhancements

Which epic should I orchestrate? (Enter number or bead ID)

Note: Run /analyze-bead <id> first if the epic hasn't been analyzed yet.
```

### PHASE 2: Confirm Ready Beads

Read ready beads from `bd ready` and check their notes for implementation context:

```bash
# Get all ready leaf beads for this epic
bd show <epic-id>  # to see hierarchy
bd ready           # to find which are unblocked
```

For each ready leaf bead, run `bd show <bead-id>` and check whether its output includes a NOTES section with implementation context (look for "Implementation Context" or "Files to Modify" headers).

Sort ready beads into two lists: **enriched** (have notes) and **unenriched** (missing notes).

**If any beads are unenriched**, enrich them before proceeding:

```
## Unenriched Beads Detected

The following ready beads lack implementation context in their notes:

| Bead | Title |
|------|-------|
| beads-107 | Add date range filter |

Spawning enrichment agent to analyze and populate notes...
```

Spawn a **general-purpose** subagent to enrich the unenriched beads:

```markdown
# Enrich Bead Notes

The following beads need implementation context added to their notes.
For each bead, analyze the codebase to determine files to modify, relevant tests,
applicable skills and standards, and acceptance criteria. Then update the bead's
notes using `bd update <bead-id> --append-notes "..."`.

Follow the enrichment process from Phase 4 of the `/analyze-bead` command.

Beads to enrich:
{list of unenriched bead IDs and titles}

Epic context: {epic_id} - {epic_title}
Spec: {spec_path}
```

**Wait for enrichment to complete** before spawning implementers. Re-check the beads to confirm notes were populated.

Display enriched and ready beads to user:

```
## Ready to Spawn (Wave 1)

The following beads have no blockers and are fully enriched:

| Bead | Title | Complexity | Files |
|------|-------|------------|-------|
| beads-104 | Add filter to service | small | 2 files |
| beads-106 | Create filter component | small | 1 file |

These will be worked **in parallel** by separate subagents.

Proceed? (yes / select specific beads / adjust)
```

Allow user to:
- Proceed with all ready beads
- Select specific beads to start
- Adjust before proceeding

### PHASE 3: Spawn Subagents

**IMPORTANT: Maximum 3 parallel subagents.** If more beads are ready, spawn the first 3 and queue the rest.

**Only spawn implementers for beads confirmed to have notes.** Never spawn an implementer for an unenriched bead.

**Spawning rules:**
1. Count ready beads
2. If ≤3: spawn all in parallel
3. If >3: spawn first 3, queue remainder
4. As agents complete, spawn queued beads (maintaining max 3 active)

**Spawn in parallel** using the Task tool with multiple invocations in a single message (max 3 invocations).

**Subagent prompt template:**

The bead itself contains all implementation context (description + notes populated by `/analyze-bead`). The subagent prompt is intentionally minimal:

```markdown
# Implement Bead: {bead_id}

Read your bead for the full task description and implementation context:

```bash
bd show {bead_id}
```

**IMPORTANT: Check for notes before starting.** The NOTES section must contain
implementation context (files to modify, skills, standards, acceptance criteria).
If the bead has NO notes or no "Implementation Context" section, STOP immediately
and report: "Bead {bead_id} is not enriched. Cannot implement without notes."
Do NOT attempt to research or enrich the bead yourself.

The DESCRIPTION tells you what to build. The NOTES contain your implementation
roadmap. If a spec is referenced, read it for broader context.

Follow TDD. Stay scoped to the files listed.

**Before closing:**

1. Kill any stale vitest processes: `pkill -f "vitest" 2>/dev/null || true`
2. Run lint: `npm run lint`
3. If the bead notes list specific test files under "Relevant Tests", run those
   targeted tests only (not the full suite):
   ```bash
   npx vitest run <file1> <file2> --maxThreads=2
   ```
4. If lint and targeted tests pass: `bd close {bead_id}`

Do NOT run `npm test` or the full test suite — the build-guardian handles that
once per wave after all beads complete. Do NOT close the bead if lint or
targeted tests are failing. If blocked, report back.
```

### PHASE 4: Monitor Progress

After spawning, monitor subagent progress:

```
## Spawned Workers

| Bead | Status | Agent |
|------|--------|-------|
| beads-104 | 🔄 In Progress | Agent A |
| beads-106 | 🔄 In Progress | Agent B |

Waiting for completions...
```

**Handling completions:**

When a subagent completes successfully:
1. Verify the bead was closed: `bd show <bead-id>` should show completed
2. **Run per-bead verification agents** (see Per-Bead Verification below)
3. Check what beads are now unblocked
4. Add newly-ready beads to the queue

When a subagent reports failure:
1. Review the failure reason
2. Decide: retry, investigate, or escalate

#### Per-Bead Verification

After each bead completion, spawn the applicable verification agents. These are **read-only code analysis** agents that run **in parallel** and do NOT count toward the 3-agent implementation limit (they are lightweight auditors, not implementers).

**Note:** Implementers handle lint + targeted tests before closing. The full test suite (unit, integration, build, e2e) runs once per wave via the build-guardian — see "Build Verification Gate" below.

**Discover applicable auditors dynamically.** Do NOT rely on a hardcoded list. Instead:

1. List all available auditor agents:
   ```bash
   ls .claude/agents/*-auditor.md
   ```
2. Read each auditor's frontmatter `description` to understand what it checks
3. Match auditors to the bead based on what files changed (e.g., an auditor whose description mentions "API responses" or "PII" is relevant if API handler files changed; one that mentions "accessibility" is relevant if `.vue` files changed)
4. Spawn all matched auditors in parallel

When spawning auditors that accept a spec path (check their description), pass it if known:
```
Spec: {spec_path}
```

```
Spawning per-bead verifiers for beads-104:
[list matched auditors with reasons they were selected]
```

**If verifiers report violations:**
- 🔴 Hard violations → spawn a follow-up implementer to fix, then re-verify
- 🟡 Warnings → note in wave summary, address at wave end if time permits
- 🟢 Clean → proceed to next bead or wave

### PHASE 5: Handle Failures

**Unenriched bead (implementer refused):**

If an implementer reports "Bead is not enriched", this means the pre-spawn check in Phase 2 missed it. Recover by spawning an enrichment agent, then retrying:

```
⚠️ **beads-104:** Implementer refused — bead not enriched

Spawning enrichment agent to populate notes...
```

Spawn a **general-purpose** subagent to enrich just that bead (same prompt as Phase 2 enrichment), wait for completion, then re-spawn the implementer. This does NOT count as a retry.

**Test failures:**
```
⚠️ **beads-104 failed:** Tests not passing

Spawning test-failure-investigator to diagnose...
```

Spawn `test-failure-investigator` subagent with context about the failure.

**Implementation blockers:**
```
⚠️ **beads-104 blocked:** [Agent's description of blocker]

Options:
1. Retry with adjusted approach
2. Spawn research subagent to investigate
3. Escalate to user for decision
4. Skip and continue with other beads

What should I do?
```

**Retry logic:**
- Maximum 2 retries per bead
- Each retry should include learnings from previous attempt
- After 2 failures, escalate to user
- Enrichment-then-retry does NOT count toward the retry limit

### PHASE 6: Cascade to Next Wave

When beads complete, check for newly-unblocked work:

```bash
bd ready
```

Check the epic's notes to see which beads were expected to unblock, then verify they appear in `bd ready`.

```
## Wave 1 Complete

✅ beads-104: Add filter to service - DONE
✅ beads-106: Create filter component - DONE

## Newly Unblocked (Wave 2)

| Bead | Title | Was Blocked By |
|------|-------|----------------|
| beads-105 | Expose filter in API | beads-104 |
| beads-107 | Integrate filter UI | beads-106 |

Spawning Wave 2 workers...
```

#### Cross-Bead Integration Verification

**After all beads in a wave have completed AND passed per-bead verification**, spawn the `cross-bead-integration-verifier` before starting the next wave. This catches conflicts, duplication, and inconsistencies that per-bead verification misses because each bead was verified in isolation.

**Skip this step** if the wave contained only 1 bead (nothing to cross-verify).

```
## Wave 1 Integration Check

All 2 beads passed per-bead verification. Running cross-bead integration check...

Spawning cross-bead-integration-verifier for Wave 1:
- beads-104: Add filter to service
- beads-106: Create filter component
```

**If the integration verifier reports issues:**
- 🔴 Conflicts → must be resolved before spawning Wave 2. Spawn a follow-up implementer with the conflict details.
- 🟡 Duplications/Inconsistencies → address before Wave 2 if quick fix, otherwise note for end-of-epic cleanup.
- 🟢 Clean → proceed to Architecture Smell Check.

#### Architecture Smell Check

**After cross-bead integration verification passes** (or immediately after per-bead verification for single-bead waves), spawn the `architecture-auditor` for a light pass over the wave's changes. This catches vision drift, decision violations, and conceptual fragmentation that code-level auditors miss.

```
## Wave 1 Architecture Check

Spawning architecture-auditor (light pass) for Wave 1 changes...
```

The architecture-auditor reads product docs (mission.md, decisions.md, roadmap.md), diffs the wave's changes, and does a quick scan for architecture smells. This is not a deep analysis — just flag anything that feels off.

**If the architecture auditor reports issues:**
- 🔴 HIGH (decision violation, vision misalignment) → must be resolved before spawning next wave.
- 🟡 MEDIUM/LOW (minor drift, unclear rationale) → note in wave summary, address if quick fix.
- 🟢 PASS → proceed to Build Verification Gate.

#### Build Verification Gate

**NEVER spawn more than one build-guardian at a time. Test suites must not run concurrently.**

After all beads in a wave have passed per-bead auditors (and the cross-bead-integration-verifier if wave size > 1), spawn **ONE** `build-guardian` agent for the entire wave. This is the single point where the full test suite runs.

```
## Wave 1 Build Verification

All beads passed per-bead auditors and integration check.
Spawning build-guardian for Wave 1 (full test suite)...
```

The build-guardian runs sequentially: lint → unit tests → integration tests → build → e2e tests. Wait for it to complete before spawning the next wave.

**If build-guardian passes:** Proceed to cascade (spawn Wave 2).

**If build-guardian fails:**
1. Spawn `test-failure-investigator` to attribute the failure to a specific bead's commit (the build-guardian report includes `git log` output to help).
2. Spawn a follow-up implementer for the responsible bead to fix the issue.
3. Re-run the build-guardian after the fix.
4. Only proceed to the next wave once the build is green.

```
## Build Verification Failed

❌ Unit tests: 2 failures detected
   Likely caused by: beads-104 (Add filter to service)

Spawning test-failure-investigator to diagnose...
```

#### Cascade to Next Wave

For each newly-ready bead, check that it has implementation context in its notes. If any lack notes (e.g. they were added after `/analyze-bead` ran), enrich them before spawning implementers — follow the same enrichment flow from Phase 2.

Repeat Phase 2-6 for each wave until no beads remain.

### PHASE 7: Epic Completion

When all beads are complete:

1. **Verify epic status:**
   ```bash
   bd show <epic-id>
   ```

2. **Run final verification:**
   Spawn `implementation-verifier` subagent:
   ```
   Verify the implementation of epic {epic_id}.

   Spec: {spec_path}

   Run:
   1. Full lint check
   2. Full test suite
   3. E2E tests if applicable
   4. Verify all acceptance criteria from spec are met

   Produce verification report.
   ```

3. **Run comprehensive reviewers and auditors:**
   Discover applicable agents dynamically:
   ```bash
   ls .claude/agents/*-reviewer.md .claude/agents/*-auditor.md
   ```
   Read each agent's frontmatter `description` to determine relevance based on the epic's changed files and scope. Spawn all matched agents for a comprehensive final pass.

4. **Close the epic:**
   ```bash
   bd close <epic-id>
   ```

5. **Report completion:**

```
## 🎉 Epic Complete!

**Epic:** beads-{id} - {title}
**Spec:** {spec_path}

### Completed Beads

| Bead | Title | Completed |
|------|-------|-----------|
| beads-104 | Add filter to service | ✅ |
| beads-105 | Expose filter in API | ✅ |
| beads-106 | Create filter component | ✅ |
| beads-107 | Integrate filter UI | ✅ |
| beads-108 | E2E tests | ✅ |

### Verification Results

- ✅ Lint: Passing
- ✅ Unit tests: 47 passing
- ✅ Integration tests: 12 passing
- ✅ E2E tests: 3 passing
- ✅ Spec acceptance criteria: All met

### Summary

[Brief summary of what was implemented]

### Files Changed

- src/server/calendar/service/event.ts
- src/server/public/api/v1/events.ts
- src/site/components/CategoryFilter.vue
- [etc.]

Ready for PR/merge.
```

## Orchestration Options

### Selective Spawning

User can specify which beads to work:
```
/spawn-bead-workers beads-100 --only beads-104,beads-106
```

### Sequential Mode

For debugging or careful review:
```
/spawn-bead-workers beads-100 --sequential
```

This works one bead at a time, waiting for user approval between each.

### Dry Run

Preview what would be spawned without executing:
```
/spawn-bead-workers beads-100 --dry-run
```

## Error Recovery

### Partial Completion

If orchestration is interrupted:

```
/spawn-bead-workers beads-100 --resume
```

This:
1. Checks which beads are already complete
2. Identifies in-progress beads (may need cleanup)
3. Finds ready beads that haven't started
4. Resumes from current state

### Rollback

If a wave introduces issues:

```
The last wave introduced test failures. Options:

1. Investigate and fix forward
2. Revert changes from wave N
3. Pause and review manually

What should I do?
```

## Subagent Configuration

### Parallel Limits (HARD LIMIT: 3)

**Maximum 3 subagents running at any time.** This is not configurable.

Rationale:
- Prevents context/memory overload
- Keeps orchestration trackable
- Reduces merge conflicts from parallel work
- Maintains quality over throughput

If more beads are ready, queue them and report:
```
## Wave 1 Spawning

⚠️ 5 beads ready, spawning 3 (parallel limit)

Active (3/3):
- beads-104 ✅ Spawned
- beads-106 ✅ Spawned
- beads-108 ✅ Spawned

Queued (will spawn as slots free):
- beads-110 (next)
- beads-112

I'll spawn queued beads as active ones complete.
```

### Subagent Type Selection

Default: `implementer` subagent

For specific bead types, may use:
- `test-failure-investigator` for test-fixing beads
- `frontend-standards-reviewer` for style/standards beads
- Custom subagent if specified in bead metadata

## Verification Agent Strategy

The workflow uses a layered verification strategy. Each layer catches different classes of issues. Agents are **discovered dynamically** at each phase — never rely on a hardcoded list.

### Agent Discovery Process

At each verification phase, discover applicable agents by listing `.claude/agents/` and reading frontmatter descriptions:

```bash
# Discover auditor agents (code-phase reviewers)
ls .claude/agents/*-auditor.md

# Discover verifier agents
ls .claude/agents/*-verifier.md

# Discover reviewer agents (comprehensive reviewers)
ls .claude/agents/*-reviewer.md
```

Read each agent's frontmatter `description` to understand what it checks and when it applies. Match agents to the changed files and work scope.

Note: Implementers run `npm run lint` + targeted tests (specific files from bead notes) before closing. No full test suite at this stage.

When spawning auditors that accept a spec path (check their description), pass it if known:
```
Spec: {spec_path}
```

### Per-Bead Verification (after each bead completes)

Discover and spawn all `*-auditor` agents whose descriptions match the changed files. Run them in parallel — they are read-only code analysis agents that do not count toward the 3-agent implementation limit.

### Per-Wave Verification (after all beads in a wave complete + per-bead auditors pass)

1. `cross-bead-integration-verifier` — spawn if wave has 2+ beads (catches conflicts from parallel isolation)
2. `architecture-auditor` — always spawn (light pass for vision drift, decision violations)
3. `build-guardian` — always spawn ONCE per wave (full sequential test suite: lint → unit → integration → build → e2e). **NEVER more than one build-guardian at a time.**

### Epic Completion Verification (after all beads done)

Discover and spawn all `*-reviewer`, `*-auditor`, and `*-verifier` agents whose descriptions indicate comprehensive/final-pass reviews. Always include `implementation-verifier` for full spec verification.

### Verification Flow Diagram

```
Bead completes (implementer runs lint + targeted tests pre-close)
  └─ [dynamically discovered *-auditor agents matched to changed files]
       │
       ▼
All beads in wave complete + per-bead auditors pass
  └─ cross-bead-integration-verifier (if wave size > 1, code analysis only)
       │
       ▼
  └─ architecture-auditor (light pass, code analysis only)
       │
       ▼
  └─ build-guardian (ONCE per wave, sequential: lint → unit → integration → build → e2e)
       │                ⚠️ NEVER more than one build-guardian at a time
       ▼
All waves complete (epic done)
  └─ [dynamically discovered *-reviewer, *-auditor, *-verifier agents for comprehensive pass]
  └─ implementation-verifier (always — full spec verification)
```

## Integration with Build Guardian

Test execution is centralized at the **wave level** to prevent concurrent vitest instances from causing memory pressure and flaky tests.

**Per-bead (inside implementer, before closing):**
1. Implementer runs `npm run lint` to catch style issues immediately
2. If bead notes list "Relevant Tests", implementer runs those specific files only: `npx vitest run <file1> <file2> --maxThreads=2`
3. Implementer closes the bead if lint and targeted tests pass

**Per-wave (orchestrator spawns after all per-bead auditors + cross-bead verifier pass):**
1. Orchestrator spawns ONE `build-guardian` for the entire wave
2. Build-guardian runs the full sequential suite: lint → unit → integration → build → e2e
3. Only after build-guardian passes does the orchestrator spawn the next wave

**Stale process cleanup:** Any agent that runs vitest or other test commands must kill stale test processes before starting, to prevent zombie processes from prior runs consuming resources:
```bash
# Kill any lingering vitest processes before running tests
pkill -f "vitest" 2>/dev/null || true
```

All `*-auditor` agents are purely read-only code analysis — they never run tests and can safely run in parallel with each other.
