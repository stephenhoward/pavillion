# .claude/tools

Deterministic CLI tools for agents to call during orchestration. Agents do the
judgment (selection, triage, review); these scripts do the mechanical work
(parsing `bd` output, git checks, gh-stack operations) so results are
consistent and testable.

This replaces the retired script-launches-agent orchestrator that lived at
`.claude/orchestrators/` — the surviving deterministic logic moved here as
agent-callable CLIs (agent-uses-script).

## Tools

All commands print JSON to stdout. Run from the repo root.

```bash
# Bead classifiers and utilities
npx tsx .claude/tools/bead.ts state <bead-id>            # lifecycle state verdict
npx tsx .claude/tools/bead.ts sizing-check <bead-id>     # 2-of-3 decomposition heuristic
npx tsx .claude/tools/bead.ts enrichment-check <bead-id> # exit 0 enriched, 1 not
npx tsx .claude/tools/bead.ts escalate <id> <reason> [phase]  # needs-human label + note
npx tsx .claude/tools/bead.ts agents <suffix>            # list *-advisor/-auditor/-verifier agents

# Git / gh-stack operations (conventions: git-workflow skill, stacking.md)
npx tsx .claude/tools/stack.ts safe-to-start [parent]    # clean tree + HEAD-at-base check
npx tsx .claude/tools/stack.ts plan '<json>'             # dependency-chain plan for an epic
npx tsx .claude/tools/stack.ts create <branch> <parent> --chained|--single
npx tsx .claude/tools/stack.ts submit <branch> --chained|--single
npx tsx .claude/tools/stack.ts sync                      # gh stack sync --prune
```

Local branch/worktree cleanup lives with its skill rather than here: the CLI
is `.claude/skills/git-cleanup/scripts/git-cleanup.ts` and the flow that
drives it is `.claude/skills/git-cleanup/SKILL.md`.

## Tests

```bash
npx vitest run --config .claude/tools/vitest.config.ts
```

That config covers both `.claude/tools/test/` and the `scripts/test/`
directory of any skill that ships its own tooling.
