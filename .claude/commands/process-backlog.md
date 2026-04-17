# Process Backlog

Autonomous backlog orchestrator. Picks the top-priority ready bead, drives it
from whatever state it's in through shape → (decompose) → analyze → implement →
verify → PR, and exits. One-shot per invocation — wrap in `/loop` for
continuous processing.

## Arguments

- `--dry-run` — run Phases 0–2 only, emit a plan report, make zero changes.

No other arguments. The command always picks the next bead itself.

## Usage

Run the Node orchestrator and print its output verbatim:

```bash
tsx .claude/orchestrators/process-backlog.ts "$@"
```

Print the output to the user and exit. Do nothing else — the orchestrator
handles all phase routing, subagent dispatch, logging, and error handling
internally.

## Direct invocation (outside Claude Code)

For autonomous runs (cron, /loop, CI), invoke the orchestrator directly:

```bash
tsx .claude/orchestrators/process-backlog.ts
tsx .claude/orchestrators/process-backlog.ts --dry-run
```

## Design references

- Orchestrator source: `.claude/orchestrators/process-backlog.ts`
- Phase modules: `.claude/orchestrators/lib/phase-*.ts`
- JSON schemas: `.claude/orchestrators/schemas/*.json`
- Per-run logs: `.claude/orchestrators/logs/<run-id>/`
- Architecture docs: `/Users/stephen/.claude/plans/jaunty-percolating-biscuit.md`
