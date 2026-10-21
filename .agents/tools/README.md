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

### `upgrade-dependencies.ts`

The mechanical half of `/upgrade-dependencies`. It belongs to a command rather than a
skill, so it lives here.

```bash
npx tsx .agents/tools/upgrade-dependencies.ts dashboard
npx tsx .agents/tools/upgrade-dependencies.ts prs
npx tsx .agents/tools/upgrade-dependencies.ts tick <approve-branch key>
npx tsx .agents/tools/upgrade-dependencies.ts renovate [timeout-minutes]
npx tsx .agents/tools/upgrade-dependencies.ts worktree <renovate/* branch>
npx tsx .agents/tools/upgrade-dependencies.ts annotate <pr> <ruling-file> <file>...
```

- `dashboard` (read-only) reads issue #561.
  - `queue`: what to tick, in order, as `{key, peers}`.
  - `candidates`: every unticked Pending Approval item with its `packages`
    (`runtime`, `dev`, `types`, `action`, `docker` or `unknown`), `tier`,
    `importFiles`, `releasedAt`, `demands` and `waitsFor`.
    - Tiers: 1 is tooling with no runtime footprint, 2 is runtime with at
      most two importing files under `src/` and `scripts/`, 3 is broad or
      unrecognised. Within a tier, the oldest first stable release of the
      target major goes first; undated items follow in dashboard order.
    - Coupling comes from the newest target-major version's
      `peerDependencies`. When neither package can move alone (the installed
      version of each refuses the other's new major), the pair folds into
      one `queue` entry under the package that demands the other.
    - When the demanded package can go green alone, or is already ticked or
      open, the demander `waitsFor` it and stays out of `queue`.
  - `awaitingRenovate`: ticked items whose PR has not opened.
  - `alreadyApplied`: unticked items `package.json` already satisfies. The
    dashboard lags hand-made bumps until Renovate's next run.
- `prs` (read-only) covers open major `renovate/*` PRs not labelled
  `security`. It returns `kind`, `migrated`, `failing`, `rerunRunIds`,
  `headSha` and `createdAt`.
  - Commit origin decides `in-hand`: Renovate's commits are authored by
    `renovate-bot`, `/upgrade-dependencies` commits carry `Migrated-by:
    upgrade-dependencies`, and anything else is the maintainer's.
  - The CI re-run budget is read from each failing workflow run's attempt
    number. External statuses (not GitHub Actions) cannot be re-run, so a
    PR failing only those classifies without one.
- `tick` changes one `- [ ]` to `- [x]` and nothing else. It refuses bulk
  boxes, absent or already-ticked keys, and non-`renovate/*` keys.
- `renovate` dispatches `renovate.yaml` and blocks until that run completes
  or the timeout passes. The default timeout of 15 minutes is longer than
  the Bash tool's limit, so run it in the background.
- `worktree` checks a Renovate branch out in
  `.agents/worktrees/upgrade-dependencies`, creating the worktree on first use. It
  then runs `npm ci` there and prints `path` and `resetSha`. Each branch has
  its own lockfile, so the launch checkout is never installed into.
- `annotate` keeps Renovate's PR body and appends (or replaces) `## Migration
  made on your behalf` with the ruling and files changed.

Things that look wrong but are not:
- Renovate opens PRs with the maintainer's token, so the PR author is the
  maintainer. Only commit authors identify Renovate.
- The dashboard's *Open* section lists PRs merged since Renovate last ran.
  `prs` asks GitHub directly.
- Renovate stops rebasing a branch once it carries someone else's commit.
  That keeps a pushed migration intact, but the branch then stops following
  `main`.

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
