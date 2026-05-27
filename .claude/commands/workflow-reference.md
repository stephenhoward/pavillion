# Agent OS + Beads Workflow Reference

Quick reference for the complete plan-to-implementation workflow.

## The Pipeline

```
┌──────────────────────────────────────────────────────┐
│  /plan                                               │
│                                                      │
│  State-routed: DRAFT → ADVISE → CONFIRM-AND-WRITE    │
│  → optional DECOMPOSE → optional ANALYZE             │
│                                                      │
│  Spec scratchpad under docs/.scratch/                │
│  (gitignored, deleted after bead is written)         │
│  Output: bead populated, advised, optionally an      │
│  enriched epic with ready-to-work leaves             │
└────────────────────────┬─────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────┐
│  /spawn-bead-workers                                 │
│                                                      │
│  Parallel subagents → cascade → complete             │
└──────────────────────────────────────────────────────┘
```

### Single Entry Point

`/plan` is the unified planning command. It detects the current state of the bead (if any) and runs only the phases needed.

| Invocation | Behavior |
|---|---|
| `/plan` | Blank slate: DRAFT → ADVISE → ask about DECOMPOSE |
| `/plan pv-xxxx` | Resume bead at its current state |
| `/plan --until shaped` | Stop after fields written (skip advisors) |
| `/plan --until advised` | Advisors then stop |
| `/plan --until decomposed` | Advise → decompose, stop before analyze |
| `/plan --until analyzed` | Full pipeline to ready-for-spawn |
| `/plan pv-xxxx --reshape` | Force re-run of DRAFT |
| `/plan pv-xxxx --readvise` | Force re-run of ADVISE |

## Command Quick Reference

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/plan` | Take work from idea → ready-to-implement | Any planning need — blank slate or resuming a drafted bead |
| `/decompose-bead` | Break shaped bead into epic/hierarchy | Manual decomposition (`/plan` invokes this internally) |
| `/analyze-bead` | Map dependencies, enrich bead notes | Manual analysis (`/plan` invokes this internally) |
| `/spawn-bead-workers` | Orchestrate parallel execution | Ready to implement |
| `/process-backlog` | Autonomous bead processing | Background work selection + execution |

## State Machine

```
unshaped → shaped → advised → decomposed → analyzed → executing → complete
```

See the `bead-state-assessment` skill for full details on how each state is detected.

## Common Workflows

### New Feature

```
1. /plan
   - Answer questions about scope, visuals, references
   - Review technical design and acceptance criteria in scratchpad
   - Advisory review runs automatically
   - Approve and write to bead

2. When prompted, choose to decompose
   - Subagents handle decomposition and analysis
   - Produces enriched epic with ready leaves

3. /spawn-bead-workers <epic-id>
```

### Resume an Existing Bead

```
1. /plan pv-xxxx
   - Detects current state, picks up where left off
   - Runs only the phases the bead hasn't been through

2. Continue or stop based on what the bead needs
```

### Small Feature (Skip Decomposition)

```
1. /plan --until advised
   - DRAFT + ADVISE only, stop before decompose prompt

2. bd update <id> --status=in_progress
   - Work directly on the shaped bead
```

### Verify a Hand-Drafted Bead

```
1. /plan pv-xxxx
   - If bead is `shaped` but not `advised`, runs ADVISE only
   - Advisors flag any concerns
```

### Already Decomposed

```
/analyze-bead <epic-id> → /spawn-bead-workers
```

(or `/plan <epic-id>` — it will detect `decomposed` state and offer to run analyze)

### Quick Single Feature

For tiny features that don't need planning at all:

```
bd create --title="[Feature]" --type=task
bd update <id> --status=in_progress
# Work directly, no orchestration needed
bd close <id>
```

### Resuming Work on Existing Epic

```
1. bd show <epic-id>           # Review current state
2. bd ready                     # What can be worked?
3. /analyze-bead <epic-id>     # Refresh analysis
4. /spawn-bead-workers         # Continue orchestration
```

### Adding Discovered Work

During implementation, if you find more work needed:

```bash
bd create --title="Fix edge case in filter" --type=task

# Link to epic if appropriate
bd dep add <epic-id> <new-bead-id>

# If it blocks existing work
bd dep add <blocked-bead> <new-bead-id>
```

## Beads CLI Quick Reference

```bash
# View work
bd ready                    # What can I start now?
bd list --status=open       # All open work
bd show <id>                # Full details + dependencies

# Create work
bd create --title="..." --type=epic|task|bug
bd dep add <id> <depends-on>    # id is blocked by depends-on

# Update work
bd update <id> --status=in_progress
bd close <id>
bd close <id1> <id2> <id3>      # Batch close

# Sync (ephemeral branches)
bd sync --from-main
```

## Discovering Skills and Standards

Skills and standards are discovered at runtime, not hardcoded:

- **Skills:** List `.claude/skills/` and read each `SKILL.md` frontmatter for its `description` field
- **Standards:** Read `.claude/skills/standards-routing/index.yml` for the full catalog with descriptions
- **Epic workflow:** The `epic-bead-workflow` skill applies to any epic/bead orchestration work

## Troubleshooting

### "Bead is blocked but blocker seems done"

Check if blocker was actually closed:
```bash
bd show <blocker-id>
```

If status isn't `completed`, close it:
```bash
bd close <blocker-id>
```

### "Subagent ran out of context"

Bead was likely too large. Split it:
```bash
bd create --title="[Part 1]" --type=task
bd create --title="[Part 2]" --type=task
bd dep add <part2> <part1>
```

### "Tests failing after bead completion"

Run test failure investigator:
```
Spawn test-failure-investigator to analyze failures in <bead-id>
```

### "Lost track of epic state"

Re-analyze the epic:
```
/analyze-bead <epic-id>
```

This re-reads all beads and refreshes the notes with updated dependency graph and implementation context.

## Integration Points

### With Git

- Work happens on ephemeral branch per epic (usually)
- Run `bd sync --from-main` before merging
- Each completed epic = one PR typically

### With CI/CD

- `build-guardian` runs same checks as CI
- Catch failures locally before push
- Epic completion includes full verification
