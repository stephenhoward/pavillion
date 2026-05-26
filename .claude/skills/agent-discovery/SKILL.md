---
name: Agent Discovery
description: Dynamically pick the right advisor, auditor, or verifier agent for a given bead or changed file set. Use this skill when spawning review subagents at planning checkpoints (post-shape, post-analyze) or after code changes (per-bead audits), when an orchestrator needs to know which agents exist without hard-coding their names, or when dispatching parallel review subagents via the Task tool.
---

# Agent Discovery

This skill governs how the orchestrator commands (`/process-backlog`, `/spawn-bead-workers`, `/plan`, and any future review runner) find the right advisor, auditor, or verifier for a given context. It converts two inputs — a **role** (`advisor` / `auditor`) and a **work context** (bead content or git diff) — into a list of subagents to invoke, using LLM judgment rather than a mechanical tag table.

## Two-stage process

1. **Enumerate candidates.** `discoverAgents(suffix)` lists every `.claude/agents/*-<suffix>.md` and parses name + description from YAML frontmatter. Returns `[{name, path, description}, ...]`. This is a pure disk read — no judgment happens here.

2. **Select applicable subset.** The orchestrator dispatches the `agent-selector` subagent with `role`, `candidates`, and the work context. The selector reads the agent descriptions, reasons about what concerns plausibly apply to the specific work, and returns a ranked list with rationale.

The selector replaces the legacy mechanical tag-matcher (removed in pv-2213). That matcher relied on regex-extracted file paths from bead notes and a hand-curated `AGENT_TAG_TABLE` in `helpers.ts`. Both produced silent failures: no file hints → no advisors → silent skip of review; missing tag entry → new agents never fired.

## Implementation

Helper functions live in `.claude/orchestrators/lib/helpers.ts`:

| Function | Purpose |
|---|---|
| `discoverAgents(suffix, agentsDir?)` | Lists `.claude/agents/*-<suffix>.md` files. Parses YAML frontmatter for `name` and `description`. Returns `[{name, path, description}, ...]`. Valid suffixes: `auditor`, `advisor`, `verifier`. |

Selection logic lives in the role-specific call sites:

- `phases.ts:selectAdvisors(ctx, logTag, deps)` — dispatches `agent-selector` with `bd show <beadId>` output as context. Returns `MatchedAdvisor[]`.
- `execute.ts:selectAuditors(changedFiles, ctx, deps)` — dispatches `agent-selector` with `git diff --stat main...HEAD` + `git log --oneline main..HEAD` as context. Returns `MatchedAgent[]`.

Both build their prompt via `phases.ts:buildAgentSelectorPrompt(role, candidates, context)` and parse the verdict via `phases.ts:parseAgentSelectorVerdict(raw)`.

## The agent-selector subagent

Lives at `.claude/agents/agent-selector.md`. Its input prompt contains:

- `role`: `advisor` or `auditor`
- `candidates`: list of `{name, description}` from `discoverAgents`
- `context`: bead content (advisor) or git diff-stat + log (auditor)

Its output is a single JSON object:

```json
{
  "role": "advisor" | "auditor",
  "selected": [
    { "name": "<agent name>", "rationale": "<one line>" }
  ],
  "reasoning": "<short paragraph>"
}
```

The selector has read/grep/bash/glob tools available — it may investigate a file path or expand a git diff region before deciding. It is instructed to default toward inclusion when there's a plausible concern (advisors and auditors are read-only and cheap) and to omit candidates whose descriptions clearly do not apply.

## Empty-selection escalation

When `selected` is empty the orchestrator **escalates the bead as `needs-human`** instead of silently advancing. This is the behavior change from the legacy matcher:

- **Legacy**: empty file hints or empty tag match → skip advisor review; empty auditor match → pass audit. Silent, undetectable.
- **New**: empty selection → log the empty verdict, call `bdEscalate`, halt the run. Visible in logs, visible on the bead.

An empty selection should only happen when the selector genuinely cannot identify any applicable agent (rare), or when its dispatch failed / output was malformed. In either case human review is the correct fallback.

## Verdict interpretation

Selected agents return a structured verdict that the orchestrator must act on. The two verdict systems are defined in sibling skills:

### Advisors (review shaped / analyzed beads — pre-code)

Defined in [`review-mode-advisor`](../review-mode-advisor/SKILL.md).

| Verdict | Orchestrator behavior |
|---|---|
| **APPROVE** | Proceed to the next phase. |
| **APPROVE WITH CONDITIONS** | Spawn a refinement subagent that updates the bead design/notes to address the listed conditions. Re-invoke only the advisors that raised conditions. If they APPROVE or APPROVE WITH CONDITIONS again, proceed. |
| **REQUEST CHANGES** | Spawn refinement once. If the revised bead still draws REQUEST CHANGES from any advisor, run the advisor-triage step; on unresolvable concerns, call `bdEscalate` and exit cleanly. The bead gets the `needs-human` label and an Escalation section in notes. |

### Auditors (review code diffs — post-code)

Defined in [`review-mode-auditor`](../review-mode-auditor/SKILL.md).

| Verdict | Orchestrator behavior |
|---|---|
| **PASS** | No action. |
| **PASS WITH WARNINGS** | Record warnings in the wave summary and in the final PR body. Do not block the PR. |
| **FAIL** | Do not submit the PR. Return findings to the implementer subagent for a single retry round. If a second audit still fails, escalate via `bdEscalate` and exit with the branch preserved. |

### Verifiers

Verifiers (e.g. `cross-bead-integration-verifier`, `build-guardian`) return PASS/FAIL-like verdicts and are treated like auditors for blocking purposes. They run outside the agent-selector path — the orchestrator invokes them on wave-level signals, not per-file context.

## Parallel-spawn pattern

Once the selector returns a list, the orchestrator invokes the matched agents in the **same Task tool batch** so they run concurrently. Concurrency caps by role:

- **Implementer subagents** (write code): max **3** in flight. Contend for test/lint/build resources; conflict on the working tree if they touch overlapping files.
- **Advisors and auditors** (read-only review): can safely exceed 3. In practice 4–7 parallel advisors on an API change is fine.
- **Verifiers** (integration / build checks): usually 1 at a time per wave.

## Adding a new agent

Drop a new `*-<suffix>.md` file in `.claude/agents/` with YAML frontmatter that names the file types and concerns it reviews:

```yaml
---
name: my-new-advisor
description: "Post-code auditor for ... reviews changes to ..."
tools: ...
model: sonnet
---
```

No code changes required — the selector reads the description at dispatch time and decides whether your agent applies to a given bead or diff. Write the description with the selector's prompt in mind: name the file types, domains, and concerns you review.

## Consumers

- `/process-backlog` — invokes `selectAdvisors` at planning checkpoints (Phase 3.5 post-shape, Phase 5.5 post-analyze) and `selectAuditors` at the per-bead review stage (Phase 7).
- `/spawn-bead-workers` — invokes `selectAuditors` after each bead's implementer reports complete.
- `/plan` — invokes `selectAdvisors` in its ADVISE phase, after fields are drafted and before the bead-write gate.

## Tests

Tests are co-located with the orchestrator codebase in `.claude/orchestrators/test/unit/` and `.claude/orchestrators/test/integration/`. The test suite covers:

- `discoverAgents`: auditor/advisor enumeration, invalid suffix validation.
- `phases.ts:selectAdvisors` path: via injected `selectAdvisorsFn` dependency, exercising clean, refinement-needed, escalate, and empty-selection verdicts.
- `execute.ts:selectAuditors` path: via injected `selectAuditorsFn` dependency, exercising pass, fail, retry, and empty-selection verdicts.
- Agent-selector prompt building and verdict parsing (`buildAgentSelectorPrompt`, `parseAgentSelectorVerdict`) via unit tests with canned input.
