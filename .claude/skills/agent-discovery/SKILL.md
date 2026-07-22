---
name: Agent Discovery
description: Dynamically pick the right advisor, auditor, or verifier agent for a given bead or changed file set. Use this skill when spawning review subagents at planning checkpoints (post-shape, post-analyze) or after code changes (per-bead audits), when an orchestrator needs to know which agents exist without hard-coding their names, or when dispatching parallel review subagents via the Task tool.
---

# Agent Discovery

This skill governs how orchestrating agents (`/plan`, `/spawn-bead-workers`,
`/clear-backlog`, and any future review runner) find the right advisor,
auditor, or verifier for a given context. It converts two inputs — a **role**
(`advisor` / `auditor` / `verifier`) and a **work context** (bead content or
git diff) — into a list of subagents to invoke, using your own judgment
rather than a mechanical tag table.

## Two-stage process

1. **Enumerate candidates.** Run the enumeration tool:

   ```bash
   npx tsx .claude/tools/bead.ts agents <role>
   ```

   It lists every `.claude/agents/*-<role>.md` and parses name + description
   from YAML frontmatter, emitting `[{name, path, description}, ...]` as
   JSON. This is a pure disk read — no judgment happens here.

2. **Select the applicable subset yourself.** Read each candidate's
   description and reason about what concerns plausibly apply to the specific
   work (the bead's content for advisors; the changed file set / diff for
   auditors). Produce a selected list with a one-line rationale per agent.

**Default toward inclusion.** Advisors and auditors are read-only and cheap;
missing a real issue is more expensive than one extra "nothing to flag"
report. Omit only candidates whose descriptions clearly do not apply.

## Selection heuristics

For each candidate, ask: *does the work touch any of the file types or
concerns this agent reviews?*

| If the work touches… | Include these agents |
|---|---|
| Any code file at all | `consistency-*`, `complexity-*` |
| API handlers, services, entities, models, migrations | `architecture-*`, `security-*`, `privacy-*` |
| Vue files (`.vue`) | `accessibility-*`, `stylesheet-*`, `consistency-*`, `complexity-*` |
| SCSS / styles | `stylesheet-*` |
| Locale files OR Vue templates with user text | `i18n-auditor` |
| Test files OR work that explicitly discusses test coverage | `testing-*` |
| Federation / ActivityPub code | `architecture-*`, `security-*`, `privacy-*` |
| Cookies, logging, public API responses, email templates | `privacy-*` |

## Empty-selection handling

An empty selection should be rare — it means no candidate plausibly applies.
Do not silently skip review: surface the empty selection to the user (or, in
an autonomous run, escalate the bead with
`npx tsx .claude/tools/bead.ts escalate <id> "no applicable reviewer"`)
rather than advancing as if review passed.

## Verdict interpretation

Selected agents return a structured verdict that the orchestrating agent must
act on. The two verdict systems are defined in sibling skills:

### Advisors (review shaped / analyzed beads — pre-code)

Defined in [`review-mode-advisor`](../review-mode-advisor/SKILL.md).

| Verdict | Orchestrating-agent behavior |
|---|---|
| **APPROVE** | Proceed to the next phase. |
| **APPROVE WITH CONDITIONS** | Address the listed conditions in the bead design/notes. Re-invoke only the advisors that raised conditions. If they APPROVE or APPROVE WITH CONDITIONS again, proceed. |
| **REQUEST CHANGES** | Refine once. If the revised bead still draws REQUEST CHANGES from any advisor, surface the concerns to the user or escalate the bead as `needs-human` with an Escalation note. |

### Auditors (review code diffs — post-code)

Defined in [`review-mode-auditor`](../review-mode-auditor/SKILL.md).

| Verdict | Orchestrating-agent behavior |
|---|---|
| **PASS** | No action. |
| **PASS WITH WARNINGS** | Record warnings in the wave summary and in the final PR body. Do not block the PR. |
| **FAIL** | Do not submit the PR. Return findings to the implementer subagent for a single retry round. If a second audit still fails, escalate and preserve the branch. |

### Verifiers

Verifiers (e.g. `cross-bead-integration-verifier`, `build-guardian`) return
PASS/FAIL-like verdicts and are treated like auditors for blocking purposes.
They are invoked on wave-level signals, not per-file context — see
[`bead-wave-orchestration`](../bead-wave-orchestration/SKILL.md).

## Parallel-spawn pattern

Once you have a selected list, invoke the matched agents in the **same Task
tool batch** so they run concurrently. Concurrency caps by role:

- **Implementer subagents** (write code): max **3** in flight. Contend for
  test/lint/build resources; conflict on the working tree if they touch
  overlapping files.
- **Advisors and auditors** (read-only review): can safely exceed 3. In
  practice 4–7 parallel advisors on an API change is fine.
- **Verifiers** (integration / build checks): usually 1 at a time per wave.

## Adding a new agent

Drop a new `*-<role>.md` file in `.claude/agents/` with YAML frontmatter that
names the file types and concerns it reviews:

```yaml
---
name: my-new-advisor
description: "Pre-code advisor for ... reviews specs touching ..."
tools: ...
model: sonnet
---
```

No code changes required — the enumeration tool reads the description at
dispatch time, and the selecting agent decides whether the new agent applies
to a given bead or diff. Write the description with selection in mind: name
the file types, domains, and concerns you review.

## Consumers

- `/plan` — selects advisors in its ADVISE phase, after fields are drafted
  and before the bead-write gate.
- `/spawn-bead-workers` — selects auditors after each bead's implementer
  reports complete; enumerates auditors + verifiers for the epic-completion
  sweep.
- `/clear-backlog` — may select auditors for larger Tier B changes.

## Tests

The enumeration tool is covered in `.claude/tools/test/bead.test.ts`
(`discoverAgents`: suffix matching, frontmatter parsing, missing-directory
handling). Selection is agent judgment and has no automated tests.
