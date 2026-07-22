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
├── process-backlog.ts       # Entry: CLI args, state machine loop, summary
├── lib/
│   ├── types.ts             # PhaseName enum, RunContext, RunLogger, wave types
│   ├── dispatch.ts          # runScript(), dispatch(), spawnCmd(), fanOutAdvisors()
│   ├── phases.ts            # Pre-execution: preflight → select → state → shape → advisors → decompose → analyze → branch
│   └── execute.ts           # Execution: leaf, epic waves, PR finalization
├── schemas/                 # JSON schemas for --json-schema validation
├── test/
│   ├── unit/                # 5 test files matching the 5 source files
│   ├── integration/         # Full state-machine walk tests
│   └── fixtures/            # Mocked script + dispatch outputs
└── logs/                    # Per-run logs (gitignored)
```

## Dispatch flags

Every `claude -p` invocation uses:

- `--permission-mode bypassPermissions` — autonomous execution
- `--no-session-persistence` — don't pollute resumable sessions list
- `--agent <name>` — pick agent from `.claude/agents/`
- `--json-schema <path>` — enforce structured output (omitted for prose-output agents)

`--bare` is intentionally **not** used. It disables keychain reads, forcing
`ANTHROPIC_API_KEY` auth only. Without the flag, subagents reuse the parent
session's OAuth credentials (e.g. Claude Max), which is what most users want.

## Logs

Each run creates `.claude/orchestrators/logs/<run-id>/` with stdout/stderr
per phase and a `run.jsonl` trace. The logs directory is gitignored.

## Tests

The root `vitest.config.ts` only includes `src/**` projects, so this suite
needs its own config. Run from the repo root:

```bash
npx vitest run --config .claude/orchestrators/vitest.config.ts
```
