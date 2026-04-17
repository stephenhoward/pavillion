# process-backlog orchestrator

Script-driven orchestrator that replaces the LLM routing logic from
`.claude/commands/process-backlog.md`. Runs deterministic `.sh` helpers
for scripted phases and shells out to `claude -p` for LLM-judgment phases.

## Quick start

```bash
# Dry run (phases 0-2 only, zero side effects)
tsx .claude/orchestrators/process-backlog.ts --dry-run

# Full run
tsx .claude/orchestrators/process-backlog.ts
```

## Architecture

```
.claude/orchestrators/
├── process-backlog.ts          # Entry point: args, state machine, summary
├── lib/
│   ├── context.ts              # PhaseName enum, RunContext, RunLogger types
│   ├── logger.ts               # Per-run log directory setup
│   ├── run-script.ts           # Wrapper for .sh helper invocation
│   ├── dispatch.ts             # Wrapper for claude -p subagent invocation
│   ├── fan-out-advisors.ts     # Parallel advisor dispatch helper
│   ├── wave-types.ts           # Wave state types for epic execution
│   ├── phase-0-preflight.ts    # preflight.sh + git-safe-to-start.sh
│   ├── phase-1-select.ts       # bd-top-ready.sh
│   ├── phase-2-state.ts        # bd-state.sh + dry-run gate
│   ├── phase-3-shape.ts        # Auto-shape via claude -p
│   ├── phase-3.5-advisors.ts   # Advisory review (parallel fan-out)
│   ├── phase-4-decompose.ts    # Decompose via claude -p
│   ├── phase-5-analyze.ts      # Analyze via claude -p
│   ├── phase-5.5-advisors.ts   # Post-analyze advisory review
│   ├── phase-6-branch.ts       # git branch setup (pure scripted)
│   ├── phase-7a-epic.ts        # Epic wave execution
│   ├── phase-7b-leaf.ts        # Single-leaf execution
│   ├── phase-8-pr.ts           # PR creation (pure scripted)
│   └── phase-9-report.ts       # Run summary
├── schemas/                    # JSON schemas for --json-schema validation
├── test/
│   ├── unit/                   # Per-phase unit tests
│   ├── integration/            # Full state-machine walk tests
│   └── fixtures/               # Mocked script + dispatch outputs
└── logs/                       # Per-run logs (gitignored)
    └── <run-id>/
        ├── phase-0-preflight.out
        ├── phase-0-preflight.err
        └── run.jsonl            # Structured trace
```

## Dispatch flags

Every `claude -p` invocation uses:

- `--bare` — skip SessionStart hooks
- `--permission-mode bypassPermissions` — autonomous execution
- `--no-session-persistence` — don't pollute resumable sessions list
- `--agent <name>` — pick agent from `.claude/agents/`
- `--json-schema <path>` — enforce structured output (omitted for prose-output agents)
- `--max-budget-usd <N>` — per-dispatch cost ceiling

## Logs

Each run creates `.claude/orchestrators/logs/<run-id>/` with stdout/stderr
per phase and a `run.jsonl` trace. The logs directory is gitignored.

To clean up: `rm -rf .claude/orchestrators/logs/`

## Tests

```bash
# All orchestrator tests (unit + integration)
npx vitest run .claude/orchestrators/

# Unit tests only
npx vitest run .claude/orchestrators/test/unit/

# Integration tests only
npx vitest run .claude/orchestrators/test/integration/
```
