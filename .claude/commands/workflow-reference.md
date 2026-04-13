# Agent OS + Beads Workflow Reference

Quick reference for the complete shape-to-implementation workflow.

## The Pipeline

```
┌──────────────────────────────────────────────────────┐
│  /shape-spec  or  /shape-bead                        │
│                                                      │
│  Interactive shaping (plan mode)                     │
│  → writes to bead fields                             │
│  → asks: continue to decompose + analyze?            │
│  → spawns subagents for decompose + analyze          │
│  Output: enriched epic with ready-to-work leaves     │
└────────────────────────┬─────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────┐
│  /spawn-bead-workers                                 │
│                                                      │
│  Parallel subagents → cascade → complete             │
└──────────────────────────────────────────────────────┘
```

### Two Entry Points

- **/shape-spec** — For larger features starting from scratch. Deeper exploration (visuals, references, standards, advisory review). Creates a new bead.
- **/shape-bead `<id>`** — For medium features. Shapes an existing bead. Skips what's already filled. Faster.

Both converge to the same output: a shaped bead → decomposed epic → analyzed leaves → ready for workers.

## Command Quick Reference

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/shape-spec` | Gather requirements, create shaped bead | Starting a new feature from scratch |
| `/shape-bead` | Fill bead structured fields interactively | Shaping an existing bead |
| `/decompose-bead` | Break shaped bead into epic/hierarchy | Manual decomposition (shape commands auto-decompose) |
| `/analyze-bead` | Map dependencies, enrich bead notes | Manual analysis (shape commands auto-analyze) |
| `/spawn-bead-workers` | Orchestrate parallel execution | Ready to implement |

### Legacy Commands (for existing specs)

| Command | Status | Notes |
|---------|--------|-------|
| `/write-spec` | Deprecated | shape-spec now writes to bead fields |
| `/decompose-spec` | Deprecated | shape commands auto-decompose via subagent |

These still work for specs already in `agent-os/specs/`.

## Common Workflows

### New Feature (Recommended)

```
1. /shape-spec
   - Answer questions about scope, visuals, references
   - Review technical design and acceptance criteria
   - Advisory review runs automatically

2. Choose "Continue to decompose + analyze"
   - Subagents handle decomposition and analysis
   - Produces enriched epic with ready leaves

3. /spawn-bead-workers <epic-id>
   - Parallel subagents execute leaves
   - Watch parallel execution, handle failures
```

### Shape an Existing Bead

```
1. /shape-bead <bead-id>
   - Assess existing fields, fill gaps
   - Design and acceptance criteria drafted
   - Advisory review runs automatically

2. Choose "Continue to decompose + analyze"
   - Same subagent-based pipeline as /shape-spec

3. /spawn-bead-workers <epic-id>
   - Parallel execution
```

### Small Feature (Skip Decomposition)

```
1. /shape-spec  or  /shape-bead <id>
   - Shape as normal

2. Choose "Stop here"
   - Bead is small enough to implement directly

3. bd update <id> --status=in_progress
   - Work directly on the shaped bead
```

### Already Have Beads

If beads already exist (manually created and decomposed):
```
/analyze-bead <epic-id> → /spawn-bead-workers
```

### Quick Single Feature

For tiny features that don't need shaping:
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
# Create new bead
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
