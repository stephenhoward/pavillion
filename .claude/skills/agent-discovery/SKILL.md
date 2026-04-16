---
name: Agent Discovery
description: Dynamically pick the right advisor, auditor, reviewer, or verifier agent for a given bead or changed file set. Use this skill when spawning review subagents at planning checkpoints (post-shape, post-analyze) or after code changes (per-bead audits), when an orchestrator needs to know which agents exist without hard-coding their names, or when dispatching parallel review subagents via the Task tool.
---

# Agent Discovery

This skill governs how the orchestrator commands (`/process-backlog`, `/spawn-bead-workers`, `/shape-spec`, `/shape-bead`, and any future review runner) find the right advisor, auditor, reviewer, or verifier for a given context. It converts two inputs — a **suffix** (`auditor`/`advisor`/`reviewer`/`verifier`) and a **set of relevant files** — into a ranked, rationale-carrying JSON list of agents to invoke.

The matcher script is the source of truth for the keyword table; the prose in this file explains *why* those mappings are what they are.

## Scripts in this skill

| Script | Purpose |
|---|---|
| `discover-agents.sh <suffix>` | Lists every `.claude/agents/*-<suffix>.md` and parses name + description from YAML frontmatter. Emits `[{name, path, description}, ...]`. |
| `match-agents.sh <suffix>` | Reads changed-file paths from stdin (one per line), applies the keyword table below, emits `[{name, path, description, rationale}, ...]` for each agent whose tags overlap the files' tags. |

Both scripts:

- Use `set -euo pipefail` and depend only on POSIX tools plus `jq`.
- Parse the YAML frontmatter via `awk` between `^---$` delimiters — no `yq`, `python`, or `perl`.
- Accept an `AGENTS_DIR` environment variable to override `.claude/agents` (used by fixture tests to point at `test/fixtures/agents/`).
- Reject invalid suffixes with exit code 2 plus a usage message. Valid suffixes are `auditor`, `advisor`, `reviewer`, `verifier`.

## What makes an agent applicable

Every agent under `.claude/agents/` carries a YAML frontmatter block describing its scope:

```yaml
---
name: accessibility-auditor
description: "Post-code auditor for WCAG 2.1 AA compliance on changed Vue/SCSS components..."
tools: ...
model: sonnet
---
```

The `description` field is the authoritative signal of what the agent is good at — it drives the matcher table below. When a new agent is added, its description should name the *file types* and *concerns* it reviews so the matcher table stays easy to update.

An agent "applies" to a context when at least one tag on its scope overlaps a tag on one of the changed files in the context. Tags are internal shorthand inside `match-agents.sh` — each agent gets a tag list and each file path gets a tag list; a non-empty intersection yields a match.

## Keyword → agent table

This is the human-readable version of the mapping embedded in `match-agents.sh` (the script is authoritative). Each row lists a file-path pattern, the tag it produces, and the agents that listen for that tag.

| File pattern | Tag | Matching agents (by tag listen) |
|---|---|---|
| `*.vue` | `vue` | accessibility, stylesheet, i18n, consistency, complexity, frontend-standards |
| `*.scss`, `*.css` | `scss` | stylesheet, consistency (via frontend set), complexity, frontend-standards |
| `*.test.ts`, `*.spec.ts`, `*.test.js`, `*.spec.js` | `test` | testing, consistency, complexity, test-failure-investigator |
| `src/server/*/api/*` | `api` | privacy, security, architecture, consistency, complexity |
| `src/server/*/entity/*`, `src/server/*/model/*`, `src/common/model/*` | `entity` / `model` | architecture, privacy, consistency, complexity |
| `src/server/*/service/*` | `service` | architecture, privacy, security, consistency, complexity |
| `src/server/*/migrations/*`, `src/server/*/migration/*` | `migration` | architecture, privacy, security |
| `src/client/locales/*`, `src/site/locales/*`, `*/locales/*.json`, `*/locale/*.json` | `i18n` | i18n, consistency, frontend-standards |
| `*.sh` | `script` | consistency, complexity |
| `.claude/*`, `docs/*` | `infra` | consistency, complexity |

Notes on the matrix:

- `consistency` and `complexity` are intentionally broad — they listen on nearly every tag because convention drift and unnecessary complexity can show up anywhere.
- `accessibility` is `vue`-only; accessibility is a template concern, not a server concern.
- `privacy` listens on `api`, `service`, `model`, `entity`, and `migration` because PII leaks can enter any data-layer file; the post-code auditor will still filter out false positives by looking at the actual diff.
- `cross-bead-integration-verifier` and `build-guardian` are intentionally **not tagged**. They run on wave-level signals (multiple beads implemented in parallel, build pipeline health), not per-file tags — the orchestrator invokes them outside this matcher.

## Ranking when multiple agents match

When more than one agent tags into the same context, they are returned in alphabetical order of agent name for determinism. The orchestrator that consumes the JSON may re-rank if needed, but the skill itself does not rank — every matched agent is equally applicable, and the `rationale` field explains why each matched.

If the orchestrator needs to cap concurrency, it picks the first N from the list. For lightweight read-only agents (advisors, auditors) the cap can be higher than for implementer subagents — see [Parallel-spawn pattern](#parallel-spawn-pattern) below.

## Parallel-spawn pattern

The consuming orchestrator should invoke all matched agents in the **same Task tool batch** so they run concurrently, not sequentially. The Task tool supports this: one tool-call message with multiple `Task` invocations equals one parallel fan-out.

Concurrency caps by role:

- **Implementer subagents** (write code): max **3** in flight. They contend for test/lint/build resources and conflict on the working tree if they touch overlapping files.
- **Advisors and auditors** (read-only review): can safely exceed 3 since they only read files, run static analysis, and produce reports. In practice, matching 4–7 advisors on an API change and fanning them all out in parallel is fine.
- **Verifiers** (integration / build checks): usually 1 at a time per wave.

When an agent's description explicitly says it accepts a spec path (e.g. "Analyzes spec documents in agent-os/specs/..."), pass the spec path as part of the spawning prompt. Otherwise the agent will default to `git diff --name-only` against the current branch.

## Verdict interpretation

Matched agents return a structured verdict that the orchestrator must act on. The two verdict systems are defined in sibling skills:

### Advisors (review shaped / analyzed beads — pre-code)

Defined in [`review-mode-advisor`](../review-mode-advisor/SKILL.md).

| Verdict | Orchestrator behavior |
|---|---|
| **APPROVE** | Proceed to the next phase. |
| **APPROVE WITH CONDITIONS** | Spawn a refinement subagent that updates the bead design/notes to address the listed conditions. Re-invoke only the advisors that raised conditions. If they APPROVE or APPROVE WITH CONDITIONS again, proceed. |
| **REQUEST CHANGES** | Spawn refinement once. If the revised bead still draws REQUEST CHANGES from any advisor, call `bead-backlog-selection/bd-escalate.sh <id> <reason> <phase>` and exit cleanly. The bead gets the `needs-human` label and an Escalation section in notes. |

### Auditors (review code diffs — post-code)

Defined in [`review-mode-auditor`](../review-mode-auditor/SKILL.md).

| Verdict | Orchestrator behavior |
|---|---|
| **PASS** | No action. |
| **PASS WITH WARNINGS** | Record warnings in the wave summary and in the final PR body. Do not block the PR. |
| **FAIL** | Do not submit the PR. Return findings to the implementer subagent for a single retry round. If a second audit still fails, escalate via `bd-escalate.sh` and exit with the branch preserved. |

### Reviewers and verifiers

Reviewers (e.g. `frontend-standards-reviewer`) return free-form guidance; the orchestrator incorporates their output into the PR description but does not block on them. Verifiers (e.g. `cross-bead-integration-verifier`, `build-guardian`) return PASS/FAIL-like verdicts and are treated like auditors for blocking purposes.

## Maintaining the keyword table

When a new agent is added to `.claude/agents/` or an existing agent's scope changes:

1. Add or update the `agent_profile()` case in `match-agents.sh` with the agent's tag list and a short keyword phrase (goes into the rationale string).
2. Update the [Keyword → agent table](#keyword--agent-table) above to match.
3. Add or update a fixture test under `test/` that exercises the new mapping.

Skipping step 3 means the next refactor can silently break the matching. The fixture suite covers at least: single file type (`.vue`, `.scss`, API, entity, test, i18n), empty stdin, unrecognized paths, invalid suffix, and multi-file mixed scenarios.

## Consumers

- `/process-backlog` — invokes `match-agents.sh advisor` at planning checkpoints (Phase 3.5 post-shape, Phase 5.5 post-analyze) and `match-agents.sh auditor` at the per-bead review stage (Phase 7).
- `/spawn-bead-workers` — invokes `match-agents.sh auditor` after each bead's implementer reports complete.
- `/shape-spec`, `/shape-bead` — invoke `match-agents.sh advisor` after the bead is shaped, before handing back to the user.

Each consumer passes the relevant file list in a way that fits its context:
- For a bead that hasn't been implemented yet, the "file list" is inferred from the bead's Implementation Context section (`Files to Modify`).
- For a bead that has been implemented, the file list is `git diff --name-only main...HEAD`.

## Fixture tests

Tests live in `test/`. Each `test-*.sh` file points `AGENTS_DIR` at `test/fixtures/agents/` and asserts on script output. Run the suite with:

```bash
bash .claude/skills/agent-discovery/test/run-tests.sh
```

Coverage:

- **discover-agents:** auditor enumeration, advisor enumeration, invalid suffix, missing args.
- **match-agents:** single `.vue` file (frontend fan-out), backend API + entity (server-side fan-out), `.scss` file, `*.test.ts`, migration path (advisor), i18n resource, reviewer suffix with mixed input, empty stdin, unrecognized files.
