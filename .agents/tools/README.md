# .agents/tools

Deterministic CLI tools for agents to call during orchestration. Agents do the
judgment (selection, triage, review); these scripts do the mechanical work
(parsing `bd` output, git checks, gh-stack operations) so results are
consistent and testable.

Tooling owned by a single skill lives with that skill, in a `scripts/`
subdirectory beside its `SKILL.md`. What remains here is the residue: work
that has no single owning skill, plus the shared test config.

## Tools

All commands print JSON to stdout. Run from the repo root.

```bash
npx tsx .agents/tools/bead.ts escalate <id> <reason> [phase]  # needs-human label + note
```

`escalate` is called by `agent-discovery`, `epic-bead-workflow`,
`bead-wave-orchestration`, `implementer-prompt-template`, `/clear-backlog`
and `/spawn-bead-workers` — it is a shared orchestration primitive rather
than one skill's tooling, so it has not been rehoused. Finding it a home
(most likely `epic-bead-workflow`, which documents the escalation protocol)
is the remaining cleanup.

## Tooling that lives with its skill

| Skill | CLI | Commands |
|---|---|---|
| `bead-state-assessment` | `.agents/skills/bead-state-assessment/scripts/bead.ts` | `state`, `sizing-check`, `enrichment-check` |
| `agent-discovery` | `.agents/skills/agent-discovery/scripts/agents.ts` | `<suffix>` — list `*-advisor`/`-auditor`/`-verifier` agents |
| `bead-branch-and-pr` | `.agents/skills/bead-branch-and-pr/scripts/stack.ts` | `safe-to-start`, `plan`, `create`, `submit`, `sync` |
| `git-cleanup` | `.agents/skills/git-cleanup/scripts/git-cleanup.ts` | `classify`, `execute` |

Each of those directories is self-contained: the CLI, its `lib/`, its
`test/`, and a local copy of the `run()` helper in `lib/shared.ts` here.
The SKILL.md beside it is the operator-facing flow; git/PR conventions
remain the `git-workflow` skill's to define.

## Tests

```bash
npx vitest run --config .agents/tools/vitest.config.ts
```

That config covers `.agents/tools/test/` and the `scripts/test/` directory
of every skill that ships its own tooling. The root `vitest.config.ts` only
includes `src/**`, so a bare `npx vitest run` does not see these.
